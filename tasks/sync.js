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

  var overwriteDest = function(options, src, dest) {
      grunt[options.logMethod].writeln('Overwriting ' + dest.cyan + 'because type differs.');
      try {
        grunt.file['delete'](dest);
        grunt.file.copy(src, dest);
      } catch(e) {
        grunt.log.warn('Cannot overwrite ' + dest.red);
      }
    };

  var updateIfNeeded = function(options, src, dest, srcStat, destStat) {
      // we can now compare modification dates of files
      if(srcStat.mtime.getTime() > destStat.mtime.getTime()) {
        grunt[options.logMethod].writeln('Updating file ' + dest.cyan);
        // and just update destination
        tryCopy(src, dest);
      }
    };

  var processPair = function(options, src, dest) {
      //stat destination file
      return promise.all([fs.stat(src), fs.stat(dest)]).then(function(result) {
        var srcStat = result[0], destStat = result[1];

        var isSrcDirectory = srcStat.isDirectory();
        var typeDiffers = isSrcDirectory !== destStat.isDirectory();

        // If types differ we have to overwrite destination.
        if(typeDiffers) {
          overwriteDest(options,src, dest);
        } else if(!isSrcDirectory) {
          updateIfNeeded(options, src, dest, srcStat, destStat);
        }
      }, function() {
        // we got an error which means that destination file does not exist
        // so make a copy
        if(grunt.file.isDir(src)) {
          grunt[options.logMethod].writeln('Creating ' + dest.cyan);
          tryMkdir(dest);
        } else {
          grunt[options.logMethod].writeln('Copying ' + src.cyan + ' -> ' + dest.cyan);
          tryCopy(src, dest);
        }
      });
    };

  grunt.registerMultiTask('sync', 'Synchronize content of two directories.', function() {
    var done = this.async();
    var options = {
      logMethod: this.data.verbose ? 'log' : 'verbose'
    };

    promise.all(this.files.map(function(fileDef) {
      var cwd = fileDef.cwd ? fileDef.cwd : '.';
      return promise.all(fileDef.src.map(function(src){
        var dest = path.join(fileDef.dest, src);
        // when using expanded mapping dest is the destination file
        // not the destination folder
        if(fileDef.orig.expand) {
          dest = fileDef.dest;
        }
        return processPair(options, path.join(cwd, src), dest);
      }));      
    })).then(function(promises) {
      promise.all(promises).then(done);
    });
  });
};
