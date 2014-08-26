var fs = require('promised-io/fs'),
    promise = require('promised-io/promise'),
    path = require('path'),
    glob = require('glob'),
    util = require('util');

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

    var overwriteDest = function(src, dest) {
        try {
            grunt.file['delete'](dest);
            grunt.file.copy(src, dest);
        } catch (e) {
            grunt.log.warn('Cannot overwrite ' + dest.red);
        }
    };


    var processPair = function(justPretend, logger, src, dest) {
        var doOrPretend = function(operation) {
            if (justPretend) {
                return;
            }
            operation();
        };

        var overwriteOrUpdate = function(isSrcDirectory, typeDiffers, srcStat, destStat) {

            // If types differ we have to overwrite destination.
            if (typeDiffers) {
                logger.writeln('Overwriting ' + dest.cyan + ' because type differs.');

                doOrPretend(function() {
                    overwriteDest(src, dest);
                });
                return;
            }

            // we can now compare modification dates of files
            if (isSrcDirectory || srcStat.mtime.getTime() <= destStat.mtime.getTime()) {
                return;
            }

            logger.writeln('Updating file ' + dest.cyan);
            doOrPretend(function() {
                // and just update destination
                tryCopy(src, dest);
            });
        };

        //stat destination file
        return promise.all([fs.stat(src), fs.stat(dest)]).then(function(result) {
            var srcStat = result[0],
                destStat = result[1];

            var isSrcDirectory = srcStat.isDirectory();
            var typeDiffers = isSrcDirectory !== destStat.isDirectory();

            overwriteOrUpdate(isSrcDirectory, typeDiffers, srcStat, destStat);
        }, function() {
            // we got an error which means that destination file does not exist
            // so make a copy
            if (grunt.file.isDir(src)) {
                logger.writeln('Creating ' + dest.cyan);

                doOrPretend(function() {
                    tryMkdir(dest);
                });
            } else {
                logger.writeln('Copying ' + src.cyan + ' -> ' + dest.cyan);

                doOrPretend(function() {
                    tryCopy(src, dest);
                });
            }
        });
    };

    var removePaths = function(justPretend, logger, paths) {

        return promise.all(paths.map(function(file) {
            return fs.stat(file).then(function(stat) {
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
                if (justPretend) {
                    return;
                }
                return fs.unlink(filePath);
            })).then(function() {
                // Then process directories in ascending order
                var sortedDirs = paths.dirs.sort(function(a, b) {
                    return b.length - a.length;
                });

                return promise.all(sortedDirs.map(function(dir) {
                    logger.writeln('Removing dir ' + dir.cyan + ' because not longer in src.');
                    if (justPretend) {
                        return;
                    }
                    return fs.rmdir(dir);
                }));
            });
        });

    };

    var splitFilesAndDirs = function(stats) {
        return stats.reduce(function(memo, stat) {
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
        var done = this.async(),
            logger = grunt[this.data.verbose ? 'log' : 'verbose'],
            updateOnly = !!this.data.updateOnly,
            justPretend = !!this.data.pretend,
            ignoredPatterns = this.data.ignoreInDest,
            expandedPaths = {};


        var getExpandedPaths = function(origDest) {
            expandedPaths[origDest] = expandedPaths[origDest] || [];
            return expandedPaths[origDest];
        };

        promise.all(this.files.map(function(fileDef) {
            var cwd = fileDef.cwd ? fileDef.cwd : '.';
            var isExpanded = fileDef.orig.expand;
            var origDest = path.join(fileDef.orig.dest, '');

            var processedDestinations = getExpandedPaths(origDest);
            // Always include destination as processed.
            processedDestinations.push(origDest.substr(0, origDest.length - 1));

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
                return processPair(justPretend, logger, path.join(cwd, src), dest);
            }));

        })).then(function() {
            if (updateOnly) {
                return;
            }

            var getDestPaths = function(dest, pattern) {
                var defer = new promise.Deferred();
                glob(path.join(dest, pattern), {
                    dot: true
                }, function(err, result) {
                    if (err) {
                        defer.reject(err);
                        return;
                    }
                    defer.resolve(result);
                });
                return defer.promise;
            };
            var getIgnoredPaths = function(dest, ignore) {
                var defer = new promise.Deferred();
                if (!ignore) {
                    defer.resolve([]);
                    return defer.promise;
                }

                if (!util.isArray(ignore)) {
                    ignore = [ignore]
                }

                promise.all(ignore.map(function(pattern) {
                    return getDestPaths(dest, pattern);
                })).then(function(results) {
                    var flat = results.reduce(function(memo, a) {
                        return memo.concat(a);
                    }, []);
                    defer.resolve(flat);
                }, function(err) {
                    defer.reject(err);
                });

                return defer.promise;
            };

            // Second pass
            return promise.all(Object.keys(expandedPaths).map(function(dest) {
                var processedDestinations = expandedPaths[dest];

                // We have to do second pass to remove objects from dest
                var destPaths = getDestPaths(dest, '**');

                // Check if we have any ignore patterns
                var ignoredPaths = getIgnoredPaths(dest, ignoredPatterns);

                return promise.all([destPaths, ignoredPaths]).then(function(result) {
                    // Calculate diff
                    var toRemove = fastArrayDiff(result[0], processedDestinations);
                    // And filter also ignored paths
                    toRemove = fastArrayDiff(toRemove, result[1]);
                    return removePaths(justPretend, logger, toRemove);
                });
            }));
        }).then(done);
    });
};