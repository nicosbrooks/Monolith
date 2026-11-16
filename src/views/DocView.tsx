import { Listen } from '../components/Listen'
import { useEffect, useRef, useState } from 'react'
import type { Editor as TEditor } from '@tiptap/react'
import { formatDistanceToNow } from 'date-fns'
import { History, Printer, ArrowDownWideNarrow, CheckSquare, ChevronRight, Download, FilePlus2, FolderInput, MoreHorizontal, Trash2, Upload, Copy, Star, RotateCcw, Folder, Check, CircleAlert, Loader2, GitCommitHorizontal, FileText, SmilePlus } from 'lucide-react'
import { useStore } from '../store'
import { MobileBack } from '../components/MobileBack'
import { confirmDialog } from '../components/Overlays'
import type { Item } from '../types'
import { Editor } from '../components/editor/Editor'
import { toast } from '../components/Toast'
import { htmlToText, itemEmoji } from '../lib/util'
import { wordCount } from '../lib/text'
import { createFile, isDirty, kindLabel, resolve, useSync } from '../storage/sync'
import { SourceIcon } from '../components/StorageSettings'
import { Connections } from '../components/Connections'
import { openHistory } from '../lib/history'

// Docs kept as Markdown files elsewhere: no sketches (Markdown can't hold them). A folder also holds the doc's files
// (assets/ beside it); GitHub and Drive hold text only, so no attachments there yet.
const NO_SKETCH = ['sketch', 'file']
const FOLDER_EXCLUDE = ['sketch']

const EMOJIS = ['📘', '📗', '📕', '🧠', '💡', '🧪', '📐', '🎯', '🗂️', '📝', '🚀', '🌱', '⚙️', '🎨', '📊', '🧭', '🏛️', '✨', '🔬']

export function DocView({ item }: { item: Item }) {
  const st = useStore.getState()
  const items = useStore((s) => s.items)
  const folders = useStore((s) => s.folders)
  const [ed, setEd] = useState<TEditor | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [more, setMore] = useState(false)
  const [toc, setToc] = useState<{ level: number; text: string; pos: number }[]>([])
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const source = useStore((s) => s.sources.find((x) => x.id === item.sourceId))
  const syncing = useSync((s) => (item.sourceId ? s.st[item.sourceId]?.status === 'syncing' : false))
  const isDir = !!item.file?.dir
  const note = !item.sourceId // your own docs (not files from Drive/GitHub) get folders and checklist tools
  const kind = 'doc'
  const emoji = itemEmoji(item)
  const folder = note ? folders.find((f) => f.id === item.folderId) : undefined

  // breadcrumbs
  const crumbs: Item[] = []
  let p = items.find((i) => i.id === item.parentId)
  while (p) (crumbs.unshift(p), (p = items.find((i) => i.id === p!.parentId)))
  const children = items.filter((i) => i.parentId === item.id && !i.deletedAt)

  const buildToc = (e: TEditor) => {
    const out: typeof toc = []
    e.state.doc.descendants((n, pos) => {
      if (n.type.name === 'heading' && n.textContent.trim()) out.push({ level: n.attrs.level, text: n.textContent, pos })
    })
    setToc(out)
  }

  useEffect(() => {
    const el = titleRef.current
    if (el) (el.style.height = '0'), (el.style.height = el.scrollHeight + 'px')
  }, [item.title])

  useEffect(() => {
    if (!item.title && titleRef.current) titleRef.current.focus()
  }, [item.id]) // eslint-disable-line

  const importMd = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.txt'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f || !ed) return
      const md = await f.text()
      ed.commands.setContent(md, { contentType: 'markdown', emitUpdate: true })
      if (!item.title) st.updateItem(item.id, { title: f.name.replace(/\.(md|markdown|txt)$/, '') })
      toast('Imported Markdown')
    }
    input.click()
  }
  /** The doc as one Markdown file that stands on its own: pictures embedded, attachments listed by name. */
  const asMarkdown = async () => {
    if (!ed) return ''
    const [{ inlineFiles }, { htmlToMarkdown }] = await Promise.all([import('../lib/files'), import('../lib/markdown')])
    return `# ${item.title}\n\n${htmlToMarkdown(await inlineFiles(ed.getHTML()))}`
  }
  const exportMd = async () => {
    if (!ed) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([await asMarkdown()], { type: 'text/markdown' }))
    a.download = `${item.title || kind}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const updateChecklist = (sort: boolean) => {
    if (!ed) return
    const template = document.createElement('template')
    template.innerHTML = ed.getHTML()
    template.content.querySelectorAll('ul[data-type="taskList"]').forEach((list) => {
      for (const task of Array.from(list.children).filter((li) => li.getAttribute('data-checked') === 'true')) {
        if (sort) list.appendChild(task)
        else task.setAttribute('data-checked', 'false')
      }
    })
    ed.commands.setContent(template.innerHTML, { emitUpdate: true })
    setMore(false)
  }
  const words = wordCount(item)

  return (
    <div className="doc-pane doc">
      <div className="toolbar">
        <MobileBack item={item} />
        <div className="crumbs">
          {source && (
            <span className="src-crumb">
              <SourceIcon kind={source.kind} size={13} /> {source.name}
              <ChevronRight size={12} />
            </span>
          )}
          {folder && <span className="src-crumb"><Folder size={13} /> {folder.name} <ChevronRight size={12} /></span>}
          {crumbs.map((c) => (
            <span key={c.id}>
              <button onClick={() => st.open(c.id)}>{itemEmoji(c)} {c.title || 'Untitled'}</button>
              <ChevronRight size={12} />
            </span>
          ))}
          <span className="cur">{source ? '' : emoji} {item.title || 'Untitled'}</span>
        </div>
        <span className="grow" />
        {item.deletedAt ? (
          <>
            <button className="btn sm" onClick={() => st.restoreItem(item.id)}><RotateCcw size={14} /> Recover</button>
            <button className="btn sm danger" onClick={async () => (await confirmDialog({ title: `Delete this ${kind} forever?`, body: 'This can’t be undone.', confirm: 'Delete forever', danger: true })) && st.purgeItem(item.id)}><Trash2 size={14} /> Delete forever</button>
          </>
        ) : (
          <>
            {source && !isDir ? (
              <SyncBadge item={item} kind={source.kind} syncing={syncing} />
            ) : (
              !isDir && <span className="muted small hide-sm">Edited {formatDistanceToNow(item.updatedAt, { addSuffix: true })} · {words} words</span>
            )}
            {!isDir && <Listen id={item.id} text={() => `${item.title}. ${htmlToText(useStore.getState().items.find((i) => i.id === item.id)?.content ?? '')}`} />}
            {/* A filled star means it's a favorite (a struck-out star read as "not a favorite"). */}
            <button className={`tb ${item.pinned ? 'on' : ''}`} onClick={() => st.updateItem(item.id, { pinned: !item.pinned })} title={item.pinned ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={item.pinned}><Star size={17} fill={item.pinned ? 'currentColor' : 'none'} /></button>
            <div className="drop-wrap">
              <button className="tb" aria-label="More options" aria-expanded={more} onClick={() => setMore(!more)}><MoreHorizontal size={17} /></button>
              {more && (
                <div className="drop right" onMouseLeave={() => setMore(false)}>
                  {source ? (
                    <button onClick={() => (createFile(source.id, item.id), setMore(false))}><FilePlus2 size={14} /> New file {isDir ? 'in this folder' : 'next to this one'}</button>
                  ) : (
                    <button onClick={() => (st.createItem('doc', { parentId: item.id }), setMore(false))}><FilePlus2 size={14} /> Add sub-doc</button>
                  )}
                  {!source && !emoji && <button onClick={() => (setEmojiOpen(true), setMore(false))}><SmilePlus size={14} /> Add emoji</button>}
                  {note && (
                    <>
                      <button onClick={() => updateChecklist(true)}><ArrowDownWideNarrow size={14} /> Move checked to bottom</button>
                      <button onClick={() => updateChecklist(false)}><CheckSquare size={14} /> Uncheck all</button>
                      <label className="note-move"><FolderInput size={14} /> Move to folder
                        <select aria-label="Move to folder" value={item.folderId ?? ''} onChange={(e) => (st.updateItem(item.id, { folderId: e.target.value || null }), setMore(false))}>
                          <option value="">No folder</option>
                          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </label>
                    </>
                  )}
                  {!isDir && <button onClick={() => (openHistory(item.id), setMore(false))}><History size={14} /> Earlier versions</button>}
                  {!isDir && <button onClick={() => (importMd(), setMore(false))}><Upload size={14} /> Import Markdown…</button>}
                  {!isDir && <button onClick={() => (setMore(false), setTimeout(() => window.print(), 50))}><Printer size={14} /> Print or save as PDF</button>}
                  {!isDir && <button onClick={() => (exportMd(), setMore(false))}><Download size={14} /> Export Markdown</button>}
                  {!isDir && <button onClick={async () => (setMore(false), await navigator.clipboard.writeText(await asMarkdown()), toast('Copied as Markdown'))}><Copy size={14} /> Copy as Markdown</button>}
                  {!isDir && (
                    <button
                      className="danger"
                      onClick={() => {
                        st.trashItem(item.id)
                        setMore(false)
                        const where = !source ? '' : source.kind === 'github' ? ' It will be deleted from GitHub when you commit.' : source.kind === 'gdrive' ? ' The file was moved to Drive’s trash.' : ` The file was removed from ${source.name}.`
                        toast(`Doc moved to Recently Deleted.${where}`, { action: { label: 'Undo', run: () => st.restoreItem(item.id) } })
                      }}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="page-scroll">
        <div className="doc-layout">
          <div className="page wide">
            <div className="doc-head">
              {source ? (
                isDir && <span className="doc-emoji static"><Folder size={30} strokeWidth={1.5} /></span>
              ) : (emoji || emojiOpen) && (
              <div className="drop-wrap">
                {emoji && <button className="doc-emoji" aria-label="Change emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(!emojiOpen)}>{emoji}</button>}
                {emojiOpen && (
                  <div className="emoji-grid" onKeyDown={(e) => { if (e.key === 'Escape') setEmojiOpen(false) }}>
                    {EMOJIS.filter((e) => item.id !== 'doc-guide' || e !== '📘').map((e) => <button key={e} onClick={() => (st.updateItem(item.id, { emoji: e }), setEmojiOpen(false))}>{e}</button>)}
                    {emoji && <button className="emoji-text" onClick={() => (st.updateItem(item.id, { emoji: undefined }), setEmojiOpen(false))}>Remove emoji</button>}
                    <button className="emoji-text" onClick={() => setEmojiOpen(false)}>Cancel</button>
                  </div>
                )}
              </div>
              )}
              <textarea
                ref={titleRef}
                className="doc-title"
                aria-label="Doc title"
                rows={1}
                value={item.title}
                readOnly={isDir}
                placeholder="Untitled"
                onChange={(e) => st.updateItem(item.id, { title: e.target.value.replace(/\n/g, '') })}
                onKeyDown={(e) => {
                  // Focus the body now, not on the next frame (Tiptap's focus waits one), or fast typing after Enter lands in the title.
                  if (e.key === 'Enter' || e.key === 'ArrowDown') (e.preventDefault(), ed?.view.focus(), ed?.commands.focus('start'))
                }}
              />
            </div>
            {item.file?.conflict && source && (
              <div className="sync-banner">
                <CircleAlert size={15} />
                <span>This file was changed in {kindLabel[source.kind]} while you were editing.</span>
                <button className="btn sm" onClick={() => resolve(item.id, 'theirs')}>Use theirs</button>
                <button className="btn sm" onClick={() => resolve(item.id, 'mine')}>Keep mine</button>
              </div>
            )}
            {item.file?.error && source && !item.file.conflict && (
              <div className="sync-banner"><CircleAlert size={15} /><span>Couldn’t save: {item.file.error}</span></div>
            )}
            {isDir ? (
              <p className="muted dir-info">{item.file?.path} · {children.length} item{children.length === 1 ? '' : 's'}</p>
            ) : (
            <Editor
              key={`${item.id}:${item.file?.pulls ?? 0}`}
              exclude={source ? (source.kind === 'folder' ? FOLDER_EXCLUDE : NO_SKETCH) : undefined}
              html={item.content}
              placeholder="Type / for blocks…"
              onReady={(e) => (setEd(e), buildToc(e))}
              onChange={(html, e) => (st.updateItem(item.id, { content: html }), buildToc(e))}
            />
            )}
            {children.length > 0 && (
              <div className="subdocs">
                <div className="list-group">{source ? 'Files' : 'Sub-docs'}</div>
                {children.map((c) => (
                  <button key={c.id} className="subdoc" onClick={() => st.open(c.id)}>
                    <span>{c.file?.dir ? <Folder size={14} /> : itemEmoji(c) || <FileText size={14} />}</span> {c.title || 'Untitled'}
                  </button>
                ))}
              </div>
            )}
            {!isDir && !item.deletedAt && <Connections item={item} />}
          </div>
          {toc.length > 1 && (
            <aside className="toc">
              <div className="list-group">On this page</div>
              {toc.map((h, i) => (
                <button
                  key={i}
                  className={`l${h.level}`}
                  onClick={() => {
                    if (!ed) return
                    ed.commands.setTextSelection(h.pos + 1)
                    const dom = ed.view.nodeDOM(h.pos) as HTMLElement | null
                    dom?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  {h.text}
                </button>
              ))}
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

function SyncBadge({ item, kind, syncing }: { item: Item; kind: 'folder' | 'gdrive' | 'github'; syncing: boolean }) {
  const dirty = isDirty(item)
  const f = item.file!
  let icon = <Check size={13} />
  let text = kind === 'github' ? 'Committed' : 'Saved'
  if (f.conflict) (icon = <CircleAlert size={13} />), (text = 'Conflict')
  else if (f.error) (icon = <CircleAlert size={13} />), (text = 'Not saved')
  else if (dirty && kind === 'github') (icon = <GitCommitHorizontal size={13} />), (text = f.path ? 'Uncommitted' : 'New · uncommitted')
  else if (dirty || syncing) (icon = <Loader2 size={13} className="spin" />), (text = 'Saving…')
  return (
    <span className={`sync-badge hide-sm ${f.conflict || f.error ? 'bad' : ''}`} title={f.path ? `${f.path}` : 'Not written yet'}>
      {icon} {text}
    </span>
  )
}
