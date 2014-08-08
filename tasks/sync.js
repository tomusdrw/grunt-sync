var fs = require('promised-io/fs');
var promise = require('promised-io/promise');
var path = require('path');

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
        logger.writeln('Overwriting ' + dest.cyan + 'because type differs.');
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

    grunt.registerMultiTask('sync', 'Synchronize content of two directories.', function() {
        var done = this.async();
        var logger = grunt[this.data.verbose ? 'log' : 'verbose'];

        promise.all(this.files.map(function(fileDef) {
            var cwd = fileDef.cwd ? fileDef.cwd : '.';

            return promise.all(fileDef.src.map(function(src) {
                var dest;
                // when using expanded mapping dest is the destination file
                // not the destination folder
                if (fileDef.orig.expand) {
                    dest = fileDef.dest;
                } else {
                    dest = path.join(fileDef.dest, src);
                }
                return processPair(logger, path.join(cwd, src), dest);
            }));

        })).then(function(promises) {
            return promise.all(promises);
        }).then(done);
    });
};