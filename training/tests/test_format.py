import json, sys, tempfile, subprocess, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from monolith_agent import check, parse, prompt
from datetime import datetime


def test_parse_drops_placeholders_and_bad_json():
    text, acts = parse('Sure\n@task {"text":"<the task>"}\n@task {"text":"Do laundry"}\n@event {broken')
    assert text == "Sure" and acts == [("task", {"text": "Do laundry"})]


def test_check_needs_exact_actions():
    want = [("event", {"title": "Dentist", "start": "2026-01-02T09:00"})]
    assert check('@event {"title":"dentist","start":"2026-01-02T09:00","end":"2026-01-02T10:00"}', want)["ok"]
    assert not check('@event {"title":"Dentist","start":"2026-01-03T09:00"}', want)["ok"]
    assert not check('@event {"title":"Dentist","start":"2026-01-02T09:00"}\n@task {"text":"x"}', want)["ok"]
    assert not check("Done.", want)["ok"]
    assert check("Nothing there.", [], text_must=["nothing"])["ok"]


def test_generated_rows_pass_their_own_check():
    d = tempfile.mkdtemp()
    subprocess.run([sys.executable, str(pathlib.Path(__file__).resolve().parents[1] / "generate_data.py"), "--n", "800", "--out", d], check=True, capture_output=True)
    for split in ("train", "test"):
        for line in open(f"{d}/{split}.jsonl"):
            r = json.loads(line)
            assert check(r["messages"][-1]["content"], [tuple(w) for w in r["want"]], text_must=r["text_must"])["ok"], r["category"]


def test_prompt_shape():
    m = prompt("hi", now=datetime(2026, 11, 17, 15), dates=[0, 1])
    assert m[1]["content"].endswith("Question: hi") and "today 2026-11-17" in m[1]["content"] and "Now 3 PM" in m[1]["content"]
