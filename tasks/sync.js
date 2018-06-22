var fs = require('fs-extra');
var path = require('path');
var glob = require('glob');

module.exports = function (grunt) {
  grunt.registerMultiTask('sync', 'Synchronize content of two directories.', function () {
    var done = this.async();
    var logger = grunt[this.data.verbose ? 'log' : 'verbose'];
    var updateOnly = !this.data.updateAndDelete;
    var justPretend = !!this.data.pretend;
    var failOnError = !!this.data.failOnError;
    var ignoredPatterns = this.data.ignoreInDest;
    var comparatorFactory = getComparatorFactory(this.data.compareUsing || 'mtime', logger);
    var expandedPaths = {};
    var options = this.options({
      encoding: grunt.file.defaultEncoding,
      // processContent/processContentExclude deprecated renamed to process/noProcess
      processContent: false,
      processContentExclude: []
    });
    var copyOptions = {
      encoding: options.encoding,
      process: options.process || options.processContent,
      noProcess: options.noProcess || options.processContentExclude
    };

    var getExpandedPaths = function (origDest) {
      if (!expandedPaths[origDest]) {
        // Always include destination as processed.
        expandedPaths[origDest] = [origDest.replace(new RegExp('\\' + path.sep + '$'), '')];
        return expandedPaths[origDest];
      }
      return expandedPaths[origDest];
    };

    Promise.all(this.files.map(function (fileDef) {
      var isCompactForm = this.data.src && this.data.dest;
      var cwd = fileDef.cwd ? fileDef.cwd : '.';
      var isExpanded = fileDef.orig.expand;
      var origDest = path.join(fileDef.orig.dest, '');

      var processedDestinations = getExpandedPaths(origDest);

      return Promise.all(fileDef.src.map(function (src) {
        var dest;
        // when using expanded mapping dest is the destination file
        // not the destination folder
        if (isExpanded || isCompactForm) {
          dest = convertPathsToSystemSpecific(fileDef.dest);
        } else {
          dest = path.join(fileDef.dest, src);
        }
        if (!updateOnly) {
          processedDestinations.push(dest);
          // Make sure to add directory of file as well (handle cases when source has pattern for files only)
          addDirectoriesPaths(processedDestinations, dest);
        }
        // Process pair
        return processPair(justPretend, failOnError, logger, comparatorFactory, path.join(cwd, src), dest, copyOptions);
      }));
    }, this)).then(function () {
      if (updateOnly) {
        return;
      }

      var getDestPaths = function (dest, pattern) {
        return new Promise(function (resolve, reject) {
          glob(pattern, {
            cwd: dest,
            dot: true
          }, function (err, result) {
            if (err) {
              reject(err);
              return;
            }
            resolve(result.map(function (filePath) {
              return path.join(dest, filePath);
            }));
          });
        });
      };

      var getIgnoredPaths = function (dest, ignore) {
        if (!ignore) {
          return Promise.resolve([]);
        }

        if (!Array.isArray(ignore)) {
          ignore = [ignore];
        }

        return Promise.all(ignore.map(function (pattern) {
          return getDestPaths(dest, pattern);
        })).then(function (results) {
          var flat = results.reduce(function (memo, a) {
            return memo.concat(a);
          }, []);
          return flat;
        });
      };

      // Second pass
      return Promise.all(Object.keys(expandedPaths).map(function (dest) {
        var processedDestinations = convertPathsToSystemSpecific(expandedPaths[dest]);

        // We have to do second pass to remove objects from dest
        var destPaths = getDestPaths(dest, '**');

        // Check if we have any ignore patterns
        var ignoredPaths = getIgnoredPaths(dest, ignoredPatterns);

        return Promise.all([destPaths, ignoredPaths, processedDestinations]);
      })).then(function (result) {
        var files = result.map(function (destAndIgnored) {
          var paths = convertPathsToSystemSpecific(destAndIgnored[0]);
          var ignoredPaths = convertPathsToSystemSpecific(destAndIgnored[1]);

          return [paths, ignoredPaths, destAndIgnored[2]];
        }).reduce(function (memo, destAndIgnored) {
          return memo.map(function (val, key) {
            return val.concat(destAndIgnored[key]);
          });
        }, [[], [], []]);

        // Ensure uniqueness
        var paths = files[0].filter(filterOutDuplicates);
        var ignoredPaths = files[1].filter(filterOutDuplicates);
        var processedDestinations = files[2].filter(filterOutDuplicates);

        // Calculate diff
        var toRemove = fastArrayDiff(paths, processedDestinations);
        // And filter also ignored paths
        toRemove = fastArrayDiff(toRemove, ignoredPaths);

        return removePaths(justPretend, logger, toRemove);
      });
    }).then(done);
  });

  function processPair (justPretend, failOnError, logger, comparatorFactory, src, dest, copyOptions) {
    // stat destination file
    return Promise.all([fs.stat(src), fs.stat(dest)]).then(function (result) {
      var srcStat = result[0];
      var destStat = result[1];

      var isSrcDirectory = srcStat.isDirectory();
      var typeDiffers = isSrcDirectory !== destStat.isDirectory();
      var haventChangedFn = comparatorFactory(src, srcStat, dest, destStat);

      overwriteOrUpdate(isSrcDirectory, typeDiffers, haventChangedFn);
    }, function () {
      // we got an error which means that destination file does not exist
      // so make a copy
      if (grunt.file.isDir(src)) {
        logger.writeln('Creating ' + dest.cyan);

        doOrPretend(function () {
          tryMkdir(dest);
        });
      } else {
        logger.writeln('Copying ' + src.cyan + ' -> ' + dest.cyan);

        doOrPretend(function () {
          tryCopy(src, dest, copyOptions);
        });
      }
    });

    function doOrPretend (operation) {
      if (justPretend) {
        return;
      }
      operation();
    }

    function warnOrFail (msg) {
      if (failOnError) {
        grunt.fail.warn(msg);
        return;
      }
      grunt.log.warn(msg);
    }

    function tryCopy (src, dest, copyOptions) {
      try {
        grunt.file.copy(src, dest, copyOptions);
      } catch (e) {
        warnOrFail('Cannot copy to ' + dest.red);
      }
    }

    function tryMkdir (dest) {
      try {
        grunt.file.mkdir(dest);
      } catch (e) {
        warnOrFail('Cannot create directory ' + dest.red);
      }
    }

    function overwriteDest (src, dest) {
      try {
        grunt.file['delete'](dest);
        grunt.file.copy(src, dest, copyOptions);
      } catch (e) {
        warnOrFail('Cannot overwrite ' + dest.red);
      }
    }

    function overwriteOrUpdate (isSrcDirectory, typeDiffers, haventChangedFn) {
      // If types differ we have to overwrite destination.
      if (typeDiffers) {
        logger.writeln('Overwriting ' + dest.cyan + ' because type differs.');

        doOrPretend(function () {
          overwriteDest(src, dest, copyOptions);
        });
        return;
      }

      // we can now compare the files
      if (isSrcDirectory || haventChangedFn()) {
        return;
      }

      logger.writeln('Updating file ' + dest.cyan);
      doOrPretend(function () {
        // and just update destination
        tryCopy(src, dest, copyOptions);
      });
    }
  }

  function removePaths (justPretend, logger, paths) {
    return Promise.all(paths.map(function (file) {
      return fs.stat(file).then(function (stat) {
        return {
          file: file,
          isDirectory: stat.isDirectory()
        };
      });
    })).then(function (stats) {
      var paths = splitFilesAndDirs(stats);

      // First we need to process files
      return Promise.all(paths.files.map(function (filePath) {
        logger.writeln('Unlinking ' + filePath.cyan + ' because it was removed from src.');

        if (justPretend) {
          return;
        }
        return fs.unlink(filePath);
      })).then(function () {
        // Then process directories in ascending order
        var sortedDirs = paths.dirs.sort(function (a, b) {
          return b.length - a.length;
        });

        return sortedDirs.map(function (dir) {
          logger.writeln('Removing dir ' + dir.cyan + ' because not longer in src.');
          if (justPretend) {
            return;
          }
          return fs.rmdirSync(dir);
        });
      });
    });
  }

  function splitFilesAndDirs (stats) {
    return stats.reduce(function (memo, stat) {
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
  }

  function filterOutDuplicates (val, index, array) {
    return array.indexOf(val) === index;
  }

  function fastArrayDiff (from, diff) {
    diff.map(function (v) {
      from[from.indexOf(v)] = undefined;
    });
    return from.filter(function (v) {
      return v;
    });
  }

  function convertPathToSystemSpecific (pathToConvert) {
    var newPath = path.join.apply(path, pathToConvert.split('/'));
    var startsWithSlash = pathToConvert[0] === '/';
    if (startsWithSlash) {
      return '/' + newPath;
    }

    return newPath;
  }

  function convertPathsToSystemSpecific (paths) {
    if (!paths.map) {
      return convertPathToSystemSpecific(paths);
    }

    return paths.map(function (filePath) {
      return convertPathToSystemSpecific(filePath);
    });
  }

  function addDirectoriesPaths (destinations, dest) {
    var parts = dest.split(path.sep);
    var partialPath = parts[0];

    parts.slice(1).forEach(function (part) {
      partialPath += path.sep + part;
      if (destinations.indexOf(partialPath) === -1) {
        destinations.push(partialPath);
      }
    });
  }

  function getComparatorFactory (compareUsing, logger) {
    var md5;

    switch (compareUsing) {
      case 'md5':
        md5 = require('md5-file');
        return createMd5Comparator;
      case 'mtime':
        return createMTimeComparator;
      default:
        logger.writeln("Invalid 'compareUsing' option, falling back to default 'mtime'");
        return createMTimeComparator;
    }

    function createMTimeComparator (src, srcStat, dest, destStat) {
      return function () {
        return srcStat.mtime.getTime() <= destStat.mtime.getTime();
      };
    }

    function createMd5Comparator (src, srcStat, dest, destStat) {
      return function () {
        return md5(src) === md5(dest);
      };
    }
  }
};
