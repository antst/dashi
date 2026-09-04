import dashi from '../package.json' with { type: 'json' }
import dsh from '@deepseek-ai/dsh-cmdline/package.json' with { type: 'json' }
export const VERSION_LINE = `dashi ${dashi.version} on DSH ${dsh.version}`
export const FLAG_HELP = [
  'Launch flags: --inline | --fullscreen · --accessible · -r, --resume [NAME|UUID] · -c, --continue · --fork-session · --all', '  -n, --name TITLE · --agent PRESET · --session-id UUID · --model ID [--provider ID] · --effort LEVEL', '  --permission PRESET · --yolo | --dangerously-skip-permissions · --image PATH · -h, --help'] as const
