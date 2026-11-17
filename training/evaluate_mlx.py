"""Score an MLX build (the weights the iPhone loads) on the test split, with the same checker as evaluate.py.

    pip install mlx-vlm
    python evaluate_mlx.py --model ../models/mlx/Monolith-LFM3-1.7B-4bit --data ../models/data/test.jsonl --limit 150

Text models (LFM3) load through mlx-vlm too: mlx-lm has no `lfm3` yet. Vision models (LFM2.5-VL) get the example's
picture when it has one; text models skip those examples.
"""

import argparse
import collections
import json

from monolith_agent import check


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--data", default="data/test.jsonl")
    ap.add_argument("--limit", type=int, default=150)
    ap.add_argument("--max-tokens", type=int, default=200)
    o = ap.parse_args()

    from mlx_vlm import generate, load

    model, proc = load(o.model, trust_remote_code=True)
    vision = hasattr(proc, "image_processor")
    rows = [json.loads(l) for l in open(o.data)]
    if not vision:
        rows = [r for r in rows if not r.get("image")]
    rows = rows[: o.limit]
    by, fails = collections.defaultdict(list), []
    for r in rows:
        msgs = [dict(m) for m in r["messages"][:-1]]
        image = r.get("image")
        if vision:
            msgs = [{"role": m["role"], "content": [{"type": "text", "text": m["content"]}]} for m in msgs]
            if image:
                msgs[-1]["content"].insert(0, {"type": "image"})
            # MLX conversions keep the template in chat_template.jinja, which only the tokenizer picks up.
            text = (proc if getattr(proc, "chat_template", None) else proc.tokenizer).apply_chat_template(msgs, add_generation_prompt=True, tokenize=False)
        else:
            text = proc.apply_chat_template(msgs, add_generation_prompt=True, tokenize=False, enable_thinking=False)
        out = generate(model, proc, text, image=[image] if image else None, max_tokens=o.max_tokens, temperature=0.0, verbose=False)
        reply = (out.text if hasattr(out, "text") else out).strip()
        res = check(reply, [tuple(w) for w in r["want"]], text_must=r["text_must"])
        by[r["category"]].append(res)
        if not res["ok"] and len(fails) < 8:
            fails.append((r["category"], r["messages"][-2]["content"][-160:], reply[:200]))
    allr = [x for v in by.values() for x in v]
    print(f"\nOverall: {sum(x['ok'] for x in allr)}/{len(allr)} = {sum(x['ok'] for x in allr) / len(allr):.1%}")
    print(f"Plain question wrongly made an action: {sum(x['plain_has_action'] for x in allr)}")
    for c, v in sorted(by.items()):
        print(f"  {c:10s} {sum(x['ok'] for x in v):4d}/{len(v):<4d}")
    for f in fails:
        print("\nFAIL", f[0], "\n  prompt…", f[1].replace("\n", " | "), "\n  reply  ", f[2].replace("\n", " | "))


if __name__ == "__main__":
    main()
