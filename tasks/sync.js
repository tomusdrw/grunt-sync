var fs = require('promised-io/fs');
var promise = require('promised-io/promise');
var path = require('path');

module.exports = function(grunt) {

  var overwriteDest = function(src, dest) {
      grunt.verbose.writeln('Overwriting ' + dest.cyan + 'because type differs.');
      grunt.file['delete'](dest);
      grunt.file.copy(src, dest);
    };
  var updateIfNeeded = function(src, dest, srcStat, destStat) {
      // we can now compare modification dates of files
      if(srcStat.mtime.getTime() > destStat.mtime.getTime()) {
        grunt.verbose.writeln('Updating file ' + dest.cyan);
        // and just update destination
        grunt.file.copy(src, dest);
      }
    };

  var processPair = function(src, dest) {
      //stat destination file
      return promise.all([fs.stat(src), fs.stat(dest)]).then(function(result) {
        var srcStat = result[0], destStat = result[1];

        var isSrcDirectory = srcStat.isDirectory();
        var typeDiffers = isSrcDirectory !== destStat.isDirectory();

        // If types differ we have to overwrite destination.
        if(typeDiffers) {
          overwriteDest(src, dest);
        } else if(!isSrcDirectory) {
          updateIfNeeded(src, dest, srcStat, destStat);
        }
      }, function() {
        // we got an error which means that destination file does not exist
        // so make a copy
        if(grunt.file.isDir(src)) {
          grunt.verbose.writeln('Creating ' + dest.cyan);
          grunt.file.mkdir(dest);
        } else {
          grunt.verbose.writeln('Copying ' + src.cyan + ' -> ' + dest.cyan);
          grunt.file.copy(src, dest);
        }
      });
    };

  grunt.registerMultiTask('sync', 'Synchronize content of two directories.', function() {
    var done = this.async();

    promise.all(this.files.map(function(fileDef) {
      var cwd = fileDef.cwd ? fileDef.cwd : '.';
      return promise.all(fileDef.src.map(function(src){
        var dest = path.join(fileDef.dest, src);
        // when using expanded mapping dest is the destination file
        // not the destination folder
        if(fileDef.orig.expand) {
          dest = fileDef.dest;
        }
        return processPair(path.join(cwd, src), dest);
      }));      
    })).then(function(promises) {
      promise.all(promises).then(done);
    });
  });
};
