var fs = require('promised-io/fs');
var promise = require('promised-io/promise');
var path = require('path');
var glob = require('glob');

module.exports = function(grunt) {

    var tryCopy = function(src, dest) {
        try {
            grunt.file.copy(src, dest);
        } catch (e) {
            grunt.log.warn('Cannot copy to ' + dest.red);
        }
    };

    var tryMkdir = function(dest) {
        try {
            grunt.file.mkdir(dest);
        } catch (e) {
            grunt.log.warn('Cannot create directory ' + dest.red);
        }
    };

    var overwriteDest = function(logger, src, dest) {
        logger.writeln('Overwriting ' + dest.cyan + ' because type differs.');
        try {
            grunt.file['delete'](dest);
            grunt.file.copy(src, dest);
        } catch (e) {
            grunt.log.warn('Cannot overwrite ' + dest.red);
        }
    };

    var updateIfNeeded = function(logger, src, dest, srcStat, destStat) {
        // we can now compare modification dates of files
        if (srcStat.mtime.getTime() > destStat.mtime.getTime()) {
            logger.writeln('Updating file ' + dest.cyan);
            // and just update destination
            tryCopy(src, dest);
        }
    };

    var processPair = function(logger, src, dest) {
        //stat destination file
        return promise.all([fs.stat(src), fs.stat(dest)]).then(function(result) {
            var srcStat = result[0],
                destStat = result[1];

            var isSrcDirectory = srcStat.isDirectory();
            var typeDiffers = isSrcDirectory !== destStat.isDirectory();

            // If types differ we have to overwrite destination.
            if (typeDiffers) {
                overwriteDest(logger, src, dest);
            } else if (!isSrcDirectory) {
                updateIfNeeded(logger, src, dest, srcStat, destStat);
            }
        }, function() {
            // we got an error which means that destination file does not exist
            // so make a copy
            if (grunt.file.isDir(src)) {
                logger.writeln('Creating ' + dest.cyan);
                tryMkdir(dest);
            } else {
                logger.writeln('Copying ' + src.cyan + ' -> ' + dest.cyan);
                tryCopy(src, dest);
            }
        });
    };

    var removePaths = function(logger, paths) {

      return promise.all(paths.map(function(file){
          return fs.stat(file).then(function(stat){
            return {
                file: file,
                isDirectory: stat.isDirectory()
            };
          });
      })).then(function(stats) {
        var paths = splitFilesAndDirs(stats);

        // First we need to process files
        return promise.all(paths.files.map(function(filePath) {
            logger.writeln('Unlinking ' + filePath.cyan + ' because it was removed from src.');
            return fs.unlink(filePath);
        })).then(function() {
            // Then process directories in ascending order
            var sortedDirs = paths.dirs.sort(function(a, b) {
                return b.length - a.length;
            });

            return promise.all(sortedDirs.map(function(dir){
                logger.writeln('Removing dir ' + dir.cyan + ' because not longer in src.');
              return fs.rmdir(dir);
            }));
        });
      });

    };

    var splitFilesAndDirs = function(stats) {
        return stats.reduce(function(memo, stat){
            if (stat.isDirectory) {
                memo.dirs.push(stat.file);
            } else {
                memo.files.push(stat.file);
            }
            return memo;
        }, {
            files: [],
            dirs: []
        });
    };

    var fastArrayDiff = function(from, diff) {
        diff.map(function(v) {
          from[from.indexOf(v)] = undefined;
        });
        return from.filter(function(v) {
          return v;
        });
    };

    grunt.registerMultiTask('sync', 'Synchronize content of two directories.', function() {
        var done = this.async();
        var logger = grunt[this.data.verbose ? 'log' : 'verbose'];
        var updateOnly = this.data.updateOnly;


        var expandedPaths = {};
        var getExpandedPaths = function(origDest) {
            expandedPaths[origDest] = expandedPaths[origDest] || [];
            return expandedPaths[origDest];
        };

        promise.all(this.files.map(function(fileDef) {
            var cwd = fileDef.cwd ? fileDef.cwd : '.';
            var isExpanded = fileDef.orig.expand;
            var origDest = fileDef.orig.dest;

            var processedDestinations = getExpandedPaths(origDest);

            return promise.all(fileDef.src.map(function(src) {
                var dest;
                // when using expanded mapping dest is the destination file
                // not the destination folder
                if (isExpanded) {
                    dest = fileDef.dest;
                } else {
                    dest = path.join(fileDef.dest, src);
                }
                processedDestinations.push(dest);
                return processPair(logger, path.join(cwd, src), dest);
            }));

        })).then(function(){
            if (updateOnly) {
                return;
            }
            
            // Second pass
            return promise.all(Object.keys(expandedPaths).map(function(dest) {
                var processedDestinations = expandedPaths[dest];

                // We have to do second pass to remove objects from dest
                var defer = new promise.Deferred();
                glob(path.join(dest, '**'), {
                    dot: true
                }, function(err, result) {
                    if (err) {
                        defer.reject(err);
                        return;
                    }
                    defer.resolve(result);
                });
                
                return defer.promise.then(function(result){
                     // Calculate diff
                    var toRemove = fastArrayDiff(result, processedDestinations);
                    return removePaths(logger, toRemove);
                });
            }));
        }).then(done);
    });
};