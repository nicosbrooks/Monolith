"""Score a model on the held-out split with the app's own action rules.

    python evaluate.py --model LiquidAI/LFM2.5-VL-450M --data data/test.jsonl            # the base model
    python evaluate.py --model LiquidAI/LFM2.5-VL-450M --adapter out/lora --data data/test.jsonl

Prints pass rate overall and per category, plus how often a plain question wrongly produced an action
(`plain_has_action`), which is the failure that costs the most trust. Run it on the base model first: that number
is what the trained model has to beat. `--guide` prepends the app's ACT_GUIDE to action prompts, which is how the
untuned model is used today.
"""
from __future__ import annotations

import argparse
import collections
import json

from monolith_agent import check

GUIDE = None


def load(model_id, adapter=None):
    import torch
    from transformers import AutoModelForImageTextToText, AutoProcessor

    proc = AutoProcessor.from_pretrained(model_id)
    model = AutoModelForImageTextToText.from_pretrained(model_id, torch_dtype=torch.float16, device_map="auto")
    if adapter:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, adapter)
    model.eval()
    return proc, model


def generate(proc, model, messages, image=None, max_new=200):
    from PIL import Image

    msgs = [dict(m) for m in messages]
    imgs = None
    if image:
        msgs[-1] = {"role": "user", "content": [{"type": "image"}, {"type": "text", "text": msgs[-1]["content"]}]}
        imgs = [Image.open(image).convert("RGB")]
    else:
        msgs = [{"role": m["role"], "content": [{"type": "text", "text": m["content"]}]} for m in msgs]
    text = proc.apply_chat_template(msgs, add_generation_prompt=True, tokenize=False)
    inputs = proc(text=text, images=imgs, return_tensors="pt").to(model.device)
    out = model.generate(**inputs, max_new_tokens=max_new, do_sample=False)
    return proc.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0].strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--adapter")
    ap.add_argument("--data", default="data/test.jsonl")
    ap.add_argument("--limit", type=int, default=300)
    ap.add_argument("--guide", action="store_true", help="add the app's ACT_GUIDE to action requests (untuned baseline)")
    o = ap.parse_args()
    proc, model = load(o.model, o.adapter)
    rows = [json.loads(l) for l in open(o.data)][: o.limit]
    by = collections.defaultdict(list)
    fails = []
    for r in rows:
        msgs = r["messages"][:-1]
        if o.guide and r["want"]:
            msgs[-1]["content"] = msgs[-1]["content"].replace("Question:", open("act_guide.txt").read().strip() + "\n\nQuestion:", 1)
        reply = generate(proc, model, msgs, r.get("image"))
        res = check(reply, [tuple(w) for w in r["want"]], text_must=r["text_must"])
        by[r["category"]].append(res)
        if not res["ok"] and len(fails) < 8:
            fails.append((r["category"], msgs[-1]["content"][-160:], reply[:200]))
    allr = [x for v in by.values() for x in v]
    print(f"\nOverall: {sum(x['ok'] for x in allr)}/{len(allr)} = {sum(x['ok'] for x in allr)/len(allr):.1%}")
    print(f"Plain question wrongly made an action: {sum(x['plain_has_action'] for x in allr)}")
    for c, v in sorted(by.items()):
        print(f"  {c:10s} {sum(x['ok'] for x in v):4d}/{len(v):<4d}")
    for f in fails:
        print("\nFAIL", f[0], "\n  prompt…", f[1].replace("\n", " | "), "\n  reply  ", f[2].replace("\n", " | "))


if __name__ == "__main__":
    main()
