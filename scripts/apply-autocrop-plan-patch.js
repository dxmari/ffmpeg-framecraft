#!/usr/bin/env node
/**
 * Patches AutoCrop-vertical main.py to add --plan-output so ffmpeg-framecraft
 * can run plan-only and encode in Node (single pass, better quality).
 * Idempotent: skips if patch already applied.
 */

const fs = require('fs');
const path = require('path');

const MARKER = "parser.add_argument('--plan-output'";

function applyPlanOutputPatch(mainPath) {
  if (!fs.existsSync(mainPath)) {
    throw new Error(`main.py not found: ${mainPath}`);
  }
  let content = fs.readFileSync(mainPath, 'utf8');
  if (content.includes(MARKER)) {
    return false; // already patched
  }

  // 1) Add --plan-output argument after --plan-only (4-space indent matches upstream main.py)
  const planOnlyArg = `    parser.add_argument('--plan-only', action='store_true',
                        help="Only run scene detection and analysis (Steps 1-3), then print the processing plan without encoding.")
    parser.add_argument('--frame-skip', type=int, default=0,`;
  const planOutputAddition = `    parser.add_argument('--plan-only', action='store_true',
                        help="Only run scene detection and analysis (Steps 1-3), then print the processing plan without encoding.")
    parser.add_argument('--plan-output', type=str, default=None, help='Write plan JSON when using --plan-only (used by ffmpeg-framecraft).')
    parser.add_argument('--frame-skip', type=int, default=0,`;
  if (!content.includes(planOnlyArg)) {
    throw new Error('main.py format changed: could not find --plan-only argument');
  }
  content = content.replace(planOnlyArg, planOutputAddition);

  // 2) In "if args.plan_only:" block, write JSON when --plan-output is set (4 spaces per level)
  const planOnlyBlockStart = `    if args.plan_only:
        track_count = sum(1 for s in scenes_analysis if s['strategy'] == 'TRACK')`;
  const planOnlyBlockPatched = `    if args.plan_only:
        if getattr(args, 'plan_output', None):
            import json
            plan = {'width': original_width, 'height': original_height, 'scenes': []}
            for s in scenes_analysis:
                x1, y1, x2, y2 = 0, 0, original_width, original_height
                if s['strategy'] == 'TRACK' and s.get('target_box') is not None:
                    x1, y1, x2, y2 = calculate_crop_box(s['target_box'], original_width, original_height)
                plan['scenes'].append({
                    'start': s['start_seconds'],
                    'end': s['end_seconds'],
                    'strategy': s['strategy'],
                    'x': x1,
                    'w': x2 - x1
                })
            with open(args.plan_output, 'w') as f:
                json.dump(plan, f, indent=2)
        track_count = sum(1 for s in scenes_analysis if s['strategy'] == 'TRACK')`;
  if (!content.includes(planOnlyBlockStart)) {
    throw new Error('main.py format changed: could not find plan_only block');
  }
  content = content.replace(planOnlyBlockStart, planOnlyBlockPatched);

  fs.writeFileSync(mainPath, content);
  return true;
}

module.exports = { applyPlanOutputPatch, MARKER };

if (require.main === module) {
  const mainPath = path.resolve(process.argv[2] || path.join(__dirname, '../autocrop-vertical/main.py'));
  try {
    const applied = applyPlanOutputPatch(mainPath);
    console.log(applied ? 'Plan-output patch applied to main.py' : 'main.py already patched');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
