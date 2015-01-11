var fs = require('promised-io/fs'),
  promise = require('promised-io/promise'),
  path = require('path'),
  glob = require('glob'),
  util = require('util'),
  _ = require('lodash');

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

  var convertPathsToSystemSpecific = function(paths) {
    return paths.map(function(filePath) {
      return path.join.apply(path, filePath.split('/'));
    });
  };

  var addDirectoriesPaths = function(arr, dest) {
    var f = dest.split(path.sep);
    var i, p;
    p = f[0];

    for (i = 1; i < f.length - 1; ++i) {
      p += path.sep + f[i];
      if (arr.indexOf(p) === -1) {
        arr.push(p);
      }
    }
  };

  grunt.registerMultiTask('sync', 'Synchronize content of two directories.', function() {
    var done = this.async(),
      logger = grunt[this.data.verbose ? 'log' : 'verbose'],
      updateOnly = !this.data.updateAndDelete,
      justPretend = !!this.data.pretend,
      ignoredPatterns = this.data.ignoreInDest,
      expandedPaths = {};


    var getExpandedPaths = function(origDest) {
      if (!expandedPaths[origDest]) {
        // Always include destination as processed.
        expandedPaths[origDest] = [origDest.replace(new RegExp("\\" + path.sep + "$"), '')];
        return expandedPaths[origDest];
      }
      return expandedPaths[origDest];
    };

    promise.all(this.files.map(function(fileDef) {
      var isCompactForm = this.data.src && this.data.dest;
      var cwd = fileDef.cwd ? fileDef.cwd : '.';
      var isExpanded = fileDef.orig.expand;
      var origDest = path.join(fileDef.orig.dest, '');

      var processedDestinations = getExpandedPaths(origDest);

      return promise.all(fileDef.src.map(function(src) {
        var dest;
        // when using expanded mapping dest is the destination file
        // not the destination folder
        if (isExpanded || isCompactForm) {
          dest = fileDef.dest;
        } else {
          dest = path.join(fileDef.dest, src);
        }
        if (!updateOnly) {
          processedDestinations.push(dest);
          // Make sure to add directory of file as well (handle cases when source has pattern for files only)
          addDirectoriesPaths(processedDestinations, dest);
        }
        // Process pair
        return processPair(justPretend, logger, path.join(cwd, src), dest);
      }));

    }, this)).then(function() {
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
          ignore = [ignore];
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
        var processedDestinations = convertPathsToSystemSpecific(expandedPaths[dest]);

        // We have to do second pass to remove objects from dest
        var destPaths = getDestPaths(dest, '**');

        // Check if we have any ignore patterns
        var ignoredPaths = getIgnoredPaths(dest, ignoredPatterns);

        return promise.all([destPaths, ignoredPaths, processedDestinations]);
      })).then(function(result) {
        var files = result.map(function(destAndIgnored) {
          var paths = convertPathsToSystemSpecific(destAndIgnored[0]);
          var ignoredPaths = convertPathsToSystemSpecific(destAndIgnored[1]);

          return [paths, ignoredPaths, destAndIgnored[2]];
        }).reduce(function(memo, destAndIgnored) {
          return memo.map(function(val, key) {
            return val.concat(destAndIgnored[key]);
          });
        }, [[], [], []]);
        
        // TODO Find some faster way to ensure uniqueness here
        var paths = _.uniq(files[0]);
        var ignoredPaths = _.uniq(files[1]);
        var processedDestinations = _.uniq(files[2]);

        // Calculate diff
        var toRemove = fastArrayDiff(paths, processedDestinations);
        // And filter also ignored paths
        toRemove = fastArrayDiff(toRemove, ignoredPaths);
  
        return removePaths(justPretend, logger, toRemove);
      });
    }).then(done);
  });
};
