# mc-recipe-agent

Generic Mission Control recipe executor.

This image is intentionally not tied to one recipe. The recipe supplies:

- `/recipe/SOUL.md`
- `/recipe/recipe.yaml`
- task metadata through `/workspace/.mc/task.json`
- read-only references under `/refs/*`
- extra skills under `/skills/*`

The image supplies a small tool runtime around an OpenRouter model. The recipe
decides which capability tools are exposed by listing them in `recipe.yaml`:

- `read_file`
- `list_dir`
- `write_file`
- `run_shell`

Mission Control control tools are always available as appropriate for the runner
mode:

- post checkpoints
- submit completion
- submit quality-review verdicts in review mode

Build locally:

```bash
bash docker/recipe-agent/build.sh
```

Recipe requirements:

```yaml
image: mc-recipe-agent:latest
secrets:
  - OPENROUTER_API_KEY
tools:
  - read_file
  - list_dir
  - write_file
  - run_shell
```

Mission Control loads recipe secrets from `.data/runner/secrets/<NAME>` and injects them into the container env-file at run time.

The agent defaults to OpenRouter. Recipes can swap any Mission Control-registered OpenRouter model by changing `model.primary` in `recipe.yaml`. Anthropic direct API remains supported only when a recipe explicitly sets `model.provider: anthropic` and declares `ANTHROPIC_API_KEY`.
