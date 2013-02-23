# Grunt-sync

A [grunt](http://github.com/gruntjs/grunt/) task to keep directories in sync.
It is very similar to [grunt-contrib-copy](https://github.com/gruntjs/grunt-contrib-copy) but
tries to copy only those files that has actually changed.

## Usage

```bash
npm install grunt-sync --save
```

Within your grunt file:

```javascript
  grunt.initConfig({

    sync: {
      main: {
        files: [{
          cwd: 'src'
          src: ['./**'],
          dest: 'bin',
        }]
      }
    }

  });

  grunt.loadNpmTasks('grunt-sync');
  grunt.registerTask('default', 'sync');
```

## More examples
Examples taken from grunt-contrib-copy, because syntax is almost the same.
```javascript
sync: {
  main: {
    files: [
      {src: ['path/**'], dest: 'dest/'}, // includes files in path and its subdirs
      {cwd: 'path/', src: ['./**'], dest: 'dest/'}, // makes all src relative to cwd
      {flatten: true, src: ['path/**'], dest: 'dest/', filter: 'isFile'} // flattens results to a single level
      {filter: 'isFile', src: ['path/*'], dest: 'dest/'}, // includes files in path
    ]
  }
}
```

Objects from `files` array are passed right to `grunt.file.expandMapping` function so you can also use any option from [grunt.file docs](https://github.com/gruntjs/grunt/wiki/grunt.file).


## TODO
Task does not remove files and directories in `dest` which are no longer in `src`.