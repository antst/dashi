import dashi from '../package.json' with { type: 'json' }
import dsh from '@deepseek-ai/dsh-cmdline/package.json' with { type: 'json' }
export const VERSION_LINE = `dashi ${dashi.version} on DSH ${dsh.version}`
export const FLAG_HELP = [
  'Launch flags: --inline | --fullscreen · --accessible · --verbose · -r, --resume [NAME|UUID] · -c, --continue · --fork-session · --all', '  -n, --name TITLE · --agent PRESET · --session-id UUID · --model ID [--provider ID] · --effort LEVEL', '  --permission PRESET · --tools NAMES · --disallowedTools NAMES · --yolo | --dangerously-skip-permissions · --image PATH', '  --system-prompt TEXT | --system-prompt-file PATH · --append-system-prompt TEXT | --append-system-prompt-file PATH · -h, --help'] as const
