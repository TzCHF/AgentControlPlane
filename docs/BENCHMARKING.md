# Benchmarking

AgentControlPlane compares two execution paths for one engineering task.

## Paths

`direct` sends the original request to an executor.

`controlled` records controller usage, sends a compact engineering brief to an
executor, and records executor usage separately.

## Required controls

Each pair uses the same:

- repository commit;
- clean workspace state;
- executor and model;
- reasoning effort;
- sandbox and network policy;
- acceptance criteria;
- time and token ceilings.

Run each pair at least three times. Report the median and the complete raw data.

## Metrics

- controller input, cached input, output, and reasoning tokens;
- executor input, cached input, output, and reasoning tokens;
- total tokens;
- elapsed time;
- acceptance result;
- test result;
- human corrections;
- changed files;
- tool calls.

Executor savings measure the change in executor tokens. Total savings include
controller and executor tokens. A useful result also reports completion rate,
because a low-token failed run does not satisfy the task.

## Report command

```powershell
npm.cmd run benchmark:report -- benchmark/example-results.json
```

The command reads an array or an object with a `cases` array and prints one JSON
report to standard output.
