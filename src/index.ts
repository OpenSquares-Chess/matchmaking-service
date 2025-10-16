import cluster, { Worker } from 'node:cluster';
import os from 'node:os';
import process from 'node:process';

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
}

