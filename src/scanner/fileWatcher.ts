import chokidar from 'chokidar';
import * as path from 'path';

export interface WatcherOptions {
  rootDir: string;
  include: string[];
  exclude: string[];
  onFileChanged: (filePath: string) => void;
  onFileAdded: (filePath: string) => void;
  onFileDeleted: (filePath: string) => void;
  onError?: (error: Error) => void;
}

export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;

  start(options: WatcherOptions): void {
    // Important: convert include patterns to use rootDir
    // chokidar needs full paths or patterns relative to cwd
    const watchPaths = options.include.map(p => path.join(options.rootDir, p));

    this.watcher = chokidar.watch(watchPaths, {
      ignored: options.exclude.map(p => {
        // If pattern starts with **/, it's a global pattern
        if (p.startsWith('**/')) {
          return p;
        }
        return path.join(options.rootDir, p);
      }),
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
    });

    this.watcher
      .on('change', (filePath) => options.onFileChanged(path.normalize(filePath)))
      .on('add', (filePath) => options.onFileAdded(path.normalize(filePath)))
      .on('unlink', (filePath) => options.onFileDeleted(path.normalize(filePath)))
      .on('error', (error) => {
        if (options.onError) {
          options.onError(error);
        }
      });
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
