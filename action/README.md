# Buddy Bot Action

Run Buddy Bot as a pipeline step. The step's output is schema-validated, so
later steps can consume it with `fromJSON()` and trust its shape.

## Usage

```yaml
- uses: stacksjs/buddy-bot/action@v1
  id: notes
  with:
    prompt: Summarize the dependency changes merged this week as release notes.
    output-schema: |
      {
        "type": "object",
        "properties": { "markdown": { "type": "string" } },
        "required": ["markdown"]
      }
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

- run: echo '${{ fromJSON(steps.notes.outputs.result).markdown }}'
```

## The schema contract

When `output-schema` is set, output that does not conform **fails the step**.
That is the point: a later step doing `fromJSON(steps.x.outputs.result).field`
needs the step to have failed rather than to have emitted something shaped
differently than it promised — otherwise the failure surfaces as a confusing
error three steps downstream, or worse, as an empty string that silently
publishes.

Buddy Bot re-asks on a violation, quoting the specific failures back, before
giving up. `retries` controls how many times (default 2).

The supported schema subset is `type`, `required`, `properties`, `items` and
`enum` — what an action input realistically declares.

## Inputs

| Input           | Description                                              |
| --------------- | -------------------------------------------------------- |
| `prompt`        | The prompt to run                                        |
| `prompt-file`   | Read the prompt from a file instead                      |
| `output-schema` | JSON Schema the output must satisfy                      |
| `model`         | Model override                                           |
| `retries`       | Schema retries before failing (default `2`)              |
| `version`       | buddy-bot version to run (default `latest`)              |
| `verbose`       | Log diagnostics to stderr                                |

## Without the action

The action is a thin wrapper. In any step, or on your own machine:

```bash
bunx buddy-bot run --prompt "..." --output-schema '{"type":"object"}'
```

Outside Actions the result goes to stdout; inside, it is also written to
`$GITHUB_OUTPUT` as `result`.

## Credentials

The step needs an AI provider key in the environment —
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_API_KEY`. Pass it through
`env:` as a secret; the action never takes a key as an input, because action
inputs appear in workflow logs.

## Prompt safety

The prompt is passed to the CLI through an environment variable rather than
interpolated into a shell command. If you build a prompt from a pull request
title, an issue body, or a comment, that content is attacker-controlled —
interpolating it into `run:` directly would be a command injection regardless
of which action you use.
