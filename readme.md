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
        ignoreInDest: "**/*.js", // Never remove js files from destination
        pretend: true, // Don't do any IO. Before you run the task make sure it doesn't remove too much.
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
    verbose: true,
    pretend: true, // Don't do any disk operations - just write log
    updateOnly: true // Don't remove any files from `dest` (works around 30% faster)

  }
}
```

## Changelog
* 0.1.0 - Files missing that are not in `src` are deleted from `dest` (unless you specify `updateOnly`)


## TODO
Research if it's possible to have better integration with `grunt-contrib-watch` - update only changed files instead of scanning everything.