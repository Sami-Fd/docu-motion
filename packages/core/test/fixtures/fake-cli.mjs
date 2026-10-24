// Fake CLI for tests: reads stdin, replies according to FAKE_CLI_MODE.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const mode = process.env.FAKE_CLI_MODE ?? 'fenced';
  if (mode === 'fenced') {
    process.stdout.write('Sure! Here you go:\n```json\n{"n": 3}\n```\nHope this helps.\n');
  } else if (mode === 'claude') {
    process.stdout.write(JSON.stringify({type: 'result', result: '{"n":3}'}));
  } else if (mode === 'fail') {
    process.stderr.write('not logged in');
    process.exit(2);
  } else if (mode === 'echo') {
    process.stdout.write(JSON.stringify({args: process.argv.slice(2), input}));
  } else if (mode === 'claude-error') {
    process.stdout.write(JSON.stringify({type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key'}));
  } else if (mode === 'claude-fail') {
    process.stdout.write(JSON.stringify({type: 'result', is_error: true, result: 'Please run /login'}));
    process.exit(1);
  } else if (mode === 'big') {
    process.stdout.write('x'.repeat(2 * 1024 * 1024));
    setTimeout(() => {}, 10000);
  } else if (mode === 'sleep') {
    setTimeout(() => {}, 10000);
  }
});
