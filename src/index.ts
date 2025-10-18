import cluster, { Worker } from 'node:cluster';
import os from 'node:os';
import process from 'node:process';
import { createClient } from 'redis';
import { performance } from 'perf_hooks';

type RedisClientType = ReturnType<typeof createClient>;

async function getRoomKeys(redisClient: RedisClientType, roomId: string) {
    while (true) {
        const roomKeys = await redisClient.get(`room:${roomId}:keys`);
        if (roomKeys) {
            return JSON.parse(roomKeys);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

async function findMatch(redisClient: RedisClientType, id: number) {
    const now = performance.now();
    try {
         const luaScript = `
            local queue = KEYS[1]
            local length = redis.call('LLEN', queue)
            if length < 2 then
              return nil
            end
            local player1 = redis.call('RPOP', queue)
            local player2 = redis.call('RPOP', queue)
            return {player1, player2}
        `;
        const result = await redisClient.eval(luaScript, { keys: ['players'] });
        if (result) {
            const [player1, player2] = result as [string, string];
            console.log(`(${id}) Match found between ${player1} and ${player2}`);
            const { element: roomId } = await redisClient.brPop('rooms', 0) as { key: string, element: string };
            console.log(`(${id}) Room: ${roomId} for ${player1} and ${player2}`);
            let roomKeys = await getRoomKeys(redisClient, roomId);
            roomKeys.timestamp = Date.now();
            await redisClient.set(`room:${roomId}:keys`, JSON.stringify(roomKeys));
            let [key1, key2] = roomKeys.keys;
            if (Math.random() < 0.5) {
                [key1, key2] = [key2, key1];
            }
            redisClient.publish('matchmaking:queue1', JSON.stringify({
                playerId: player1,
                matchInfo: { opponentId: player2, roomId, roomKey: key1 }
            }));
            redisClient.publish('matchmaking:queue1', JSON.stringify({
                playerId: player2,
                matchInfo: { opponentId: player1, roomId, roomKey: key2 }
            }));
        }
    } catch (error) {
        console.error('Error connecting to Redis:', error);
    }
    const elapsed = performance.now() - now;
    const delay = Math.max(0, 1000 - elapsed);

    setTimeout(async () => {
        await findMatch(redisClient, id);
    }, delay);
}

async function main(id: number) {
    const redisClient = createClient({
        url: 'redis://host.docker.internal:6379',
    });

    try {
        await redisClient.connect();
        console.log('Connected to Redis');
    } catch (error) {
        console.error('Error connecting to Redis:', error);
        process.exit(1);
    }
    
    setTimeout(async () => {
        await findMatch(redisClient, id);
    }, Math.random() * 1000);
}

if (cluster.isPrimary) {
    const cores = os.cpus().length;
    console.log(`Total cores: ${cores}`);
    console.log(`Primary process ${process.pid} is running`);

    for (let i = 0; i < cores; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker: Worker, code) => {
        console.log(`Worker ${worker.process.pid} exited with code ${code}`);
        console.log('Forking new worker!');
        cluster.fork();
    });
} else {
    console.log(`Worker process ${process.pid} is running`);

    main(process.pid);
}

