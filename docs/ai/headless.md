# Headless Runs

`buddy-bot run` executes a prompt as a pipeline step and, optionally, enforces
a schema on the output so later steps can consume it safely.

```bash
buddy-bot run --prompt "Summarize this week's dependency updates as release notes"
```

The result goes to stdout. Inside GitHub Actions it is also written to
`$GITHUB_OUTPUT` as `result`.

## Schema-validated output

```bash
buddy-bot run \
  --prompt "Summarize the dependency changes merged this week" \
  --output-schema '{
    "type": "object",
    "properties": { "markdown": { "type": "string" } },
    "required": ["markdown"]
  }'
```

When a schema is given, **output that does not conform fails the command**
(exit ≠ 0). That is the whole point of the flag. A later step doing
`fromJSON(steps.x.outputs.result).markdown` needs this step to have failed
rather than to have emitted something shaped differently than it promised —
otherwise the mistake surfaces three steps downstream as a confusing error, or
worse, as an empty string that silently publishes.

Before failing, Buddy Bot re-asks with the specific violations quoted back:

```
- markdown: is required but missing
```

That usually succeeds, and burning the step on a formatting slip would be
needless. `--retries` controls how many times (default 2).

### Supported schema subset

`type`, `required`, `properties`, `items`, `enum`.

Deliberately partial — that is what a pipeline step's schema realistically
declares. Supporting more would mean either a dependency or a half-correct
validator that passes things it should not, which is worse than a small one
that is right about what it covers.

## In a workflow

```yaml
- uses: stacksjs/buddy-bot/action@v1
  id: notes
  with:
    prompt: Summarize the dependency changes merged this week as release notes.
    output-schema: '{"type":"object","properties":{"markdown":{"type":"string"}},"required":["markdown"]}'
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

- run: echo '${{ fromJSON(steps.notes.outputs.result).markdown }}'
```

The action is a thin wrapper over the CLI — `bunx buddy-bot run` in any step
does the same thing.

## Output escaping

Multi-line values are written to `$GITHUB_OUTPUT` using heredoc syntax with a
delimiter chosen to be absent from the value. This matters: if a value could
contain the delimiter, crafted output could close the block early and inject
further outputs into the workflow, which is a real escalation once a later step
interpolates them.

## Prompt safety

Pass prompts through `--prompt-file` or the action's `prompt` input rather than
interpolating them into a shell command. If a prompt is built from a pull
request title, an issue body, or a comment, that content is attacker-controlled
— interpolating it into a `run:` block directly would be a command injection
regardless of which tool consumes it.

## Options

| Flag                     | Description                                    |
| ------------------------ | ---------------------------------------------- |
| `--prompt <text>`        | The prompt to run                              |
| `--prompt-file <path>`   | Read the prompt from a file                    |
| `--output-schema <json>` | JSON Schema the output must satisfy            |
| `--output-schema-file`   | Read the schema from a file                    |
| `--model <name>`         | Model override                                 |
| `--retries <n>`          | Schema retries before failing (default `2`)    |
| `--verbose`              | Log diagnostics to stderr                      |

Diagnostics always go to stderr; stdout carries only the result.
