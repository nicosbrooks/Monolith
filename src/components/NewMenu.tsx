import { AudioWaveform, CalendarPlus, ChevronDown, FilePlus2, ListPlus, Mic, Plus, Upload } from 'lucide-react'
import { useStore } from '../store'
import { openMenu } from './Overlays'
import { focusAsk } from './AskBar'
import { startRecording, uploadRecording } from '../lib/recordNext'
import { uploadFiles } from '../views/VaultView'

/**
 * One way to make anything: a doc, a recording, an event, a task, or files for the Vault. Events and tasks are typed
 * in the Ask bar on their page, the same as anywhere else; files go to the Vault, where docs link to them.
 */
export function NewMenu() {
  const st = useStore.getState()
  const open = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: 'Doc', icon: FilePlus2, hint: '⌘N', run: () => st.createItem('doc') },
      { label: 'Recording', icon: Mic, run: () => void startRecording() },
      { label: 'Event', icon: CalendarPlus, run: () => (st.go('calendar'), setTimeout(() => focusAsk(''), 120)) },
      { label: 'Task', icon: ListPlus, run: () => (st.go('tasks'), setTimeout(() => focusAsk(''), 120)) },
      'sep',
      { label: 'Upload files to the Vault', icon: Upload, run: uploadFiles },
      { label: 'Upload a recording', icon: AudioWaveform, run: uploadRecording },
    ])
  return (
    <button className="primary new-btn" onClick={open} aria-haspopup="menu">
      <Plus size={15} strokeWidth={2.2} aria-hidden="true" /> New <ChevronDown size={14} aria-hidden="true" />
    </button>
  )
}
