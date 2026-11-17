"""Synthetic training data for the Monolith assistant, in the app's exact prompt format.

    python generate_data.py --n 6000 --out data            # text only
    python generate_data.py --n 6000 --out data --images   # adds picture examples (needs Pillow)

Writes data/train.jsonl and data/test.jsonl. Each row: messages (system, user, assistant), image (path or null),
want (the actions a correct reply contains), text_must, category. The test split uses phrasings and titles the
training split never sees, so evaluation measures the skill, not memory. Stdlib only (Pillow for --images).
"""
from __future__ import annotations

import argparse
import json
import random
from datetime import datetime, timedelta
from pathlib import Path

from monolith_agent import prompt

TITLES_TRAIN = ["Study group", "Dentist", "Chem lab", "Team standup", "Office hours", "Gym", "Call with Mom", "Piano lesson", "Career fair", "Essay review", "Dinner with Sam", "Physics midterm", "Haircut", "Thesis meeting", "Volunteer shift", "Coffee with Priya"]
TITLES_TEST = ["Robotics club", "Eye exam", "Orchestra rehearsal", "Lab safety training", "Advisor check-in", "Pottery class", "Tax appointment", "Debate practice"]
TASKS_TRAIN = ["Finish the bio problem set", "Email Professor Lee", "Buy printer ink", "Read chapter 4", "Renew library books", "Book flights home", "Submit scholarship form", "Do laundry"]
TASKS_TEST = ["Draft the lab report", "Call the landlord", "Order a textbook", "Back up my laptop"]
DOCS_TRAIN = [("Study plan for finals", "# Study plan\n\n- Mon: Chemistry\n- Tue: Calculus\n- Wed: History"), ("Packing list", "# Packing list\n\n- Passport\n- Charger\n- Notebook")]
DOCS_TEST = [("Meeting agenda", "# Agenda\n\n1. Updates\n2. Blockers\n3. Next steps")]
LOCS = ["Room 204", "Hall B", "Library 3rd floor", "Zoom", "Main Gym"]

CREATE_TRAIN = ["add {t} {when}", "schedule {t} {when}", "put {t} on my calendar {when}", "can you book {t} {when}", "please add {t} {when}", "remind me about {t} {when}"]
CREATE_TEST = ["I need {t} on the calendar {when}", "set up {t} {when}", "block off time for {t} {when}"]
MOVE_TRAIN = ["move {t} to {when}", "reschedule {t} to {when}", "push {t} to {when}", "can you shift {t} to {when}"]
MOVE_TEST = ["{t} needs to be {when} instead", "please change {t} to {when}"]
CANCEL_TRAIN = ["cancel {t}", "delete {t} from my calendar", "remove {t}", "please cancel {t}"]
CANCEL_TEST = ["I can't make {t} anymore, cancel it", "get rid of {t}"]
TASK_TRAIN = ["add a task: {x}", "remind me to {xl}", "put {xl} on my list", "new task, {xl}"]
TASK_TEST = ["I should {xl}, add it to my tasks", "track this: {x}"]
DONE_TRAIN = ["mark {xl} as done", "I finished: {xl}", "check off {xl}", "done with {xl}"]
DONE_TEST = ["tick off {xl}", "{xl} is complete now"]
DOC_TRAIN = ["write me a {t}", "draft a doc called {t}", "make a doc: {t}"]
DOC_TEST = ["create {t} for me"]
ASK_CAL_TRAIN = ["what's on my calendar {d}?", "what do I have {d}?", "when is {t}?"]
ASK_CAL_TEST = ["am I busy {d}?", "tell me about {t}"]


def fmt_t(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M")


def pick_day(now, rng, lo=1, hi=9):
    n = rng.randint(lo, hi)
    return n, now + timedelta(days=n)


def say_when(d: datetime, n: int, hour: int, minute=0) -> str:
    h = hour % 12 or 12
    ap = "am" if hour < 12 else "pm"
    m = f":{minute:02d}" if minute else ""
    word = "tomorrow" if n == 1 else d.strftime("%A") if n < 7 else d.strftime("%A")
    return f"{word} at {h}{m}{ap}"


def make_event(rng, now, titles, offset_lo=0, offset_hi=9):
    n = rng.randint(offset_lo, offset_hi)
    d = (now + timedelta(days=n)).replace(hour=rng.randint(8, 19), minute=rng.choice([0, 0, 30]), second=0, microsecond=0)
    e = {"title": rng.choice(titles), "start": d, "end": d + timedelta(hours=rng.choice([1, 1, 2]))}
    if rng.random() < 0.3:
        e["location"] = rng.choice(LOCS)
    return n, e


def row(cat, split, msgs, reply, want, must=(), image=None):
    return {"category": cat, "split": split, "messages": msgs + [{"role": "assistant", "content": reply}], "image": image, "want": want, "text_must": list(must)}


def build(rng: random.Random, split: str, now: datetime, images: bool, out: Path):
    T = split == "train"
    titles = TITLES_TRAIN if T else TITLES_TEST
    tasks = TASKS_TRAIN if T else TASKS_TEST
    pre = lambda tpl_train, tpl_test: rng.choice(tpl_train if T else tpl_test)
    cat = rng.choice(["create", "create", "move", "cancel", "task", "done", "doc", "ask_cal", "ask_tasks", "file_qa", "file_qa", "absent", "chat"] + (["image"] if images else []))

    if cat == "create":
        n, e = make_event(rng, now, titles, 1, 6)
        s = e["start"]
        q = pre(CREATE_TRAIN, CREATE_TEST).format(t=e["title"].lower() if rng.random() < .5 else e["title"], when=say_when(s, n, s.hour, s.minute))
        if rng.random() < 0.15:
            a = {"title": e["title"], "date": s.strftime("%Y-%m-%d")}
            q = f"add {e['title']} {s.strftime('%A')} all day"
        else:
            a = {"title": e["title"], "start": fmt_t(s), "end": fmt_t(s + timedelta(hours=1))}
        msgs = prompt(q, now=now, dates=[0, 1, n] if n > 1 else [0, 1])
        return row(cat, split, msgs, f"@event {json.dumps(a)}", [("event", a)])

    if cat in ("move", "cancel"):
        n, e = make_event(rng, now, titles, 1, 6)
        evs = [e]
        s = e["start"]
        if cat == "move":
            n2, d2 = pick_day(now, rng, 1, 6)
            h = rng.randint(8, 19)
            start = d2.replace(hour=h, minute=0, second=0, microsecond=0)
            q = pre(MOVE_TRAIN, MOVE_TEST).format(t=e["title"], when=say_when(d2, n2, h))
            a = {"event": e["title"], "start": fmt_t(start)}
            msgs = prompt(q, now=now, events=evs, dates=sorted({0, 1, n2}))
            return row(cat, split, msgs, f"@move {json.dumps(a)}", [("move", a)])
        q = pre(CANCEL_TRAIN, CANCEL_TEST).format(t=e["title"])
        a = {"event": e["title"]}
        msgs = prompt(q, now=now, events=evs, dates=[0, 1])
        return row(cat, split, msgs, f"@cancel {json.dumps(a)}", [("cancel", a)])

    if cat == "task":
        x = rng.choice(tasks)
        q = pre(TASK_TRAIN, TASK_TEST).format(x=x, xl=x[0].lower() + x[1:])
        a = {"text": x}
        return row(cat, split, prompt(q, now=now), f"@task {json.dumps(a)}", [("task", a)])

    if cat == "done":
        pool = rng.sample(tasks, k=min(3, len(tasks)))
        x = pool[0]
        q = pre(DONE_TRAIN, DONE_TEST).format(xl=x[0].lower() + x[1:])
        a = {"task": x}
        msgs = prompt(q, now=now, tasks=[{"text": t, "doc": "Tasks"} for t in pool])
        return row(cat, split, msgs, f"@done {json.dumps(a)}", [("done", a)])

    if cat == "doc":
        title, md = rng.choice(DOCS_TRAIN if T else DOCS_TEST)
        q = pre(DOC_TRAIN, DOC_TEST).format(t=title.lower())
        a = {"title": title, "md": md}
        return row(cat, split, prompt(q, now=now), f"@doc {json.dumps(a)}", [("doc", a)])

    if cat == "ask_cal":
        n, e = make_event(rng, now, titles, 0, 5)
        other = make_event(rng, now, titles, 6, 9)[1]
        q = pre(ASK_CAL_TRAIN, ASK_CAL_TEST).format(d="today" if n == 0 else "tomorrow" if n == 1 else f"on {e['start']:%A}", t=e["title"])
        msgs = prompt(q, now=now, events=[e, other], dates=[0, 1, n])
        s = e["start"]
        reply = f"{e['title']} is {s:%A} at {clock_(s)}." if "when" in q or "about" in q or "busy" not in q else f"Yes, you have {e['title']} at {clock_(s)}."
        return row(cat, split, msgs, reply, [], [e["title"]])

    if cat == "ask_tasks":
        pool = rng.sample(tasks, k=min(3, len(tasks)))
        msgs = prompt(rng.choice(["what's left on my to-do list?", "what tasks do I have?"] if T else ["anything I still need to do?"]), now=now, tasks=[{"text": t, "doc": "Tasks"} for t in pool])
        return row(cat, split, msgs, "\n".join(f"- {t}" for t in pool), [], pool[:1])

    if cat == "file_qa":
        name, text, q, ans, must = rng.choice(FILES_TRAIN if T else FILES_TEST)
        return row(cat, split, prompt(q, now=now, files=[(name, text)]), ans, [], must)

    if cat == "absent":
        name, text, _, _, _ = rng.choice(FILES_TRAIN if T else FILES_TEST)
        q = rng.choice(["What is the dress code?", "Who is the guest speaker?"] if T else ["What's the parking situation?"])
        return row(cat, split, prompt(q, now=now, files=[(name, text)]), "That isn't in the file, so I can't say.", [], ["isn't in"])

    if cat == "chat":
        q, a = rng.choice([("hi", "Hi! Ask me about your calendar, tasks or docs, or tell me what to add."), ("thanks", "You're welcome.")] if T else [("hello there", "Hi! What can I help with?")])
        return row(cat, split, prompt(q, now=now), a, [])

    if cat == "image":  # a picture of a flyer with an event on it
        return image_row(rng, split, now, out)
    raise AssertionError(cat)


def clock_(d):
    from monolith_agent import clock
    return clock(d)


FILES_TRAIN = [
    ("syllabus.md", "Midterm review session Tuesday Nov 24 at 6pm in Hall B.\nFinal exam: Thursday Dec 10, 9am, Room 204.\nLate work loses 10% per day.", "When is the final exam?", "The final exam is Thursday Dec 10 at 9am in Room 204.", ["Dec 10"]),
    ("syllabus.md", "Midterm review session Tuesday Nov 24 at 6pm in Hall B.\nFinal exam: Thursday Dec 10, 9am, Room 204.\nLate work loses 10% per day.", "What's the late policy?", "Late work loses 10% per day.", ["10%"]),
    ("trip.txt", "Flight AA204 leaves Friday at 7:45am from Gate 12.\nHotel check-in is after 3pm.\nReservation under Rivera.", "What time is check-in?", "Check-in is after 3pm.", ["3pm"]),
]
FILES_TEST = [
    ("menu.txt", "Open Monday to Saturday, 11am to 9pm.\nClosed Sundays.\nReservations required for groups over 6.", "Are they open Sunday?", "No, they're closed Sundays.", ["closed"]),
    ("lab.pdf", "Page 1\nLab report due Monday Dec 7 at noon.\nPage 2\nFinal project demo is Friday Dec 11 in Room 12.", "Where is the project demo?", "The demo is Friday Dec 11 in Room 12.", ["Room 12"]),
]


def image_row(rng, split, now, out: Path):
    from PIL import Image, ImageDraw
    n, e = make_event(rng, now, TITLES_TRAIN if split == "train" else TITLES_TEST, 2, 6)
    s = e["start"]
    img = Image.new("RGB", (512, 384), (rng.randint(215, 250),) * 3)
    d = ImageDraw.Draw(img)
    for i, line in enumerate([e["title"].upper(), s.strftime("%A, %B %-d"), f"{clock_(s)}", e.get("location", "")]):
        d.text((30, 40 + i * 70), line, fill=(20, 20, 20))
    folder = out / "images"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{split}_{rng.getrandbits(32):08x}.png"
    img.save(path)
    msgs = prompt("add this to my calendar", now=now, dates=sorted({0, 1, n}))
    a = {"title": e["title"], "start": fmt_t(s), "end": fmt_t(s + timedelta(hours=1))}
    return row("image", split, msgs, f"@event {json.dumps(a)}", [("event", a)], image=str(path))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=6000)
    ap.add_argument("--out", default="data")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--images", action="store_true")
    ap.add_argument("--test-frac", type=float, default=0.08)
    o = ap.parse_args()
    rng = random.Random(o.seed)
    out = Path(o.out)
    out.mkdir(parents=True, exist_ok=True)
    counts = {"train": 0, "test": 0}
    with open(out / "train.jsonl", "w") as ft, open(out / "test.jsonl", "w") as fe:
        for i in range(o.n):
            split = "test" if rng.random() < o.test_frac else "train"
            # A different "today" every time, so the model learns to read the Dates line, not memorise a week.
            now = datetime(2026, 1, 1, rng.randint(7, 21), rng.choice([0, 15, 30, 45])) + timedelta(days=rng.randint(0, 700))
            r = build(rng, split, now, o.images, out)
            (ft if split == "train" else fe).write(json.dumps(r, ensure_ascii=False) + "\n")
            counts[split] += 1
    print(counts)


if __name__ == "__main__":
    main()
