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
          cwd: 'src',
          src: [
            '**', /* Include everything */
            '!**/*.txt' /* but exclude txt files */
          ],
          dest: 'bin',
        }],
        verbose: true // Display log messages when copying files
      }
    }

  });

  grunt.loadNpmTasks('grunt-sync');
  grunt.registerTask('default', 'sync');
```

## More examples
```javascript
sync: {
  main: {
    files: [
      {src: ['path/**'], dest: 'dest/'}, // includes files in path and its subdirs
      {cwd: 'path/', src: ['**/*.js', '**/*.css'], dest: 'dest/'}, // makes all src relative to cwd
    ],
    verbose: true
  }
}
```


## TODO
Task does not remove any files and directories in `dest` that are no longer in `src`.
