import {Resampler, audioBufferToWav} from './resources.js';
import {
  editor,
  showEditor,
  drawWaveform,
  getNiceFileName,
  setEditorConf
} from './editor.js';

const uploadInput = document.getElementById('uploadInput');
const listEl = document.getElementById('fileList');
const infoEl = document.getElementById('infoIndicator');
const DefaultSliceOptions = [0, 4, 8, 16, 32, 64, 120];
const opSliceOptions = [4, 8, 12, 16, 20, 24];
const otSliceOptions = [4, 8, 16, 32, 48, 64];
const audioConfigOptions = {
  m4410016: { sr: 44100, bd: 16, c: 1 },
  s4410016: { sr: 44100, bd: 16, c: 2 },
  m4410024: { sr: 44100, bd: 24, c: 1 },
  s4410024: { sr: 44100, bd: 24, c: 2 },
  m4410032: { sr: 44100, bd: 32, c: 1 },
  s4410032: { sr: 44100, bd: 32, c: 2 },
  m4800016: { sr: 48000, bd: 16, c: 1 },
  s4800016: { sr: 48000, bd: 16, c: 2 },
  m4800024: { sr: 48000, bd: 24, c: 1 },
  s4800024: { sr: 48000, bd: 24, c: 2 },
  m4800032: { sr: 48000, bd: 32, c: 1 },
  s4800032: { sr: 48000, bd: 32, c: 2 },

  m4410016a: { sr: 44100, bd: 16, c: 1, f: 'a' },
  s4410016a: { sr: 44100, bd: 16, c: 2, f: 'a' }
};
let masterSR = 48000;
let masterBitDepth = 16;
let masterChannels = 1;
let lastUsedAudioConfig = localStorage.getItem('lastUsedAudioConfig')?? 'm4800016';
let restoreLastUsedAudioConfig = JSON.parse(localStorage.getItem('restoreLastUsedAudioConfig'))?? true;
let pitchModifier = JSON.parse(localStorage.getItem('pitchModifier'))?? 1;
let playWithPopMarker = JSON.parse(localStorage.getItem('playWithPopMarker'))?? 0;
let zipDownloads = JSON.parse(localStorage.getItem('zipDownloads'))?? true;
let embedSliceData = JSON.parse(localStorage.getItem('embedSliceData'))?? true;
let showTouchModifierKeys = JSON.parse(localStorage.getItem('showTouchModifierKeys'))?? true;
let secondsPerFile = 0;
let audioCtx = new AudioContext({sampleRate: masterSR});
let files = [];
let unsorted = [];
let metaFiles = [];
let mergeFiles = [];
let lastSort = '';
let lastSelectedRow;
let lastSliceFileImport = []; // [].enabledTracks = {t[x]: boolean}
let lastOpKit = [];
let workBuffer;
let sliceGrid = 0;
let sliceOptions = Array.from(DefaultSliceOptions);
let lastSliceOptions = Array.from(sliceOptions);
let keyboardShortcutsDisabled = false;
let modifierKeys = {
  shiftKey: false,
  ctrlKey: false
};

metaFiles.getByFileName = function(filename) {
  let found = this.find(m =>m.name.replace(/\.[^.]*$/,'') === filename.replace(/\.[^.]*$/,''));
  if (filename === '---sliceToTransientCached---' && !found) {
    found = {
      uuid: crypto.randomUUID(),
      name: '---sliceToTransientCached---',
      sliceCount: 0,
      slices: []
    };
    metaFiles.push(found);
  }
  return found;
};
metaFiles.getByFile = function(file) {
  if (file.meta.slicedFrom) { return false; }
  const found = this.find(m =>m.name.replace(/\.[^.]*$/,'') === file.file.name.replace(/\.[^.]*$/,''));
  if (found) { return found; }
  if (file.meta.op1Json && file.meta.op1Json.start) {
    return {
      uuid: file.meta.uuid,
      name: file.file.name,
      path: file.file.path,
      cssClass: 'is-op-file',
      sliceCount: file.meta.op1Json.start.length,
      slices: file.meta.op1Json.start.map(
          (s, i) => ({
            startPoint: s,
            endPoint: file.meta.op1Json.end[i]
          })
      )
    };
  }
  if (file.meta.slices) {
    return {
      uuid: file.meta.uuid,
      name: file.file.name,
      path: file.file.path,
      cssClass: 'is-dc-file',
      sliceCount: file.meta.slices.length,
      slices: file.meta.slices.map(
          slice => ({
            startPoint: slice.s,
            endPoint: slice.e,
            name: slice.n
          })
      )
    };
  }
};
metaFiles.removeSelected = function() {
  files.forEach(f => {
    const idx = this.findIndex(i => i === this.getByFileName(f.file.name));
    f.meta.checked && idx !== -1 ? this.splice(idx, 1) : false;
  });
};
metaFiles.removeByName = function(filename) {
  const idx = this.findIndex(i => i === this.getByFileName(filename));
  if (idx !== -1) {
    this.splice(idx, 1);
  }
}

function changeAudioConfig(event, option) {
  const selection = option ||
                           event?.target?.selectedOptions[0]?.value ||
                           'm4800016';
  if (files.length > 0 && audioConfigOptions[selection].sr !== masterSR) {
    let conf = confirm(`Changing audio export sample rate will remove all files from the sample list.\n\n Do you want to continue?`);
    if (!conf) {
      event.target.selectedIndex = [...event.target.options].findIndex(s => s.value === event.target.dataset.selection);
      return false;
    }
  }
  if (option) {
    document.getElementById('audioConfigOptions').value = option;
  } else {
    lastUsedAudioConfig = selection;
    localStorage.setItem('lastUsedAudioConfig', selection);
  }
  files = audioConfigOptions[selection].sr !== masterSR ? [] : files;
  [masterSR, masterBitDepth, masterChannels] = [audioConfigOptions[selection].sr, audioConfigOptions[selection].bd, audioConfigOptions[selection].c];
  event.target.dataset.selection = selection;
  audioCtx = new AudioContext({sampleRate: masterSR});
  secondsPerFile = lastUsedAudioConfig.includes('a') ? 20 : secondsPerFile;
  toggleSecondsPerFile(false,
      secondsPerFile === 0 ? 0 :
      (masterChannels === 2 ? 20 : 12)
  );
  setEditorConf({
    audioCtx,
    masterSR,
    masterChannels,
    masterBitDepth
  });
  renderList();
}

const getFileById = (id) => {
  return files.find(f => f.meta.id === id);
};
const getFileIndexById = (id) => {
  return files.findIndex(f => f.meta.id === id);
};
const getRowElementById = (id, tableId = '#masterList') => {
  return document.querySelector(`${tableId} tr[data-id="${id}"]`);
};
const toggleModifier = (key) => {
  if (key === 'shiftKey' || key === 'ctrlKey') {
    modifierKeys[key] = !modifierKeys[key];
    document.getElementById('modifierKey' + key).classList[modifierKeys[key] ? 'add' : 'remove']('active');
    document.body.classList[modifierKeys[key] ? 'add' : 'remove'](key + '-mod-down');
  }
};

const closePopUps = () => {
  document.querySelectorAll('.pop-up').forEach(w => w.classList.remove('show'));
  stopPlayFile(false, editor.getLastItem());
  renderList();
};

const arePopUpsOpen = () => {
  return [...document.querySelectorAll('.pop-up')].some(w => w.classList.contains('show'));
};

const toggleOptionsPanel = () => {
  const buttonsEl = document.getElementById('allOptionsPanel');
  const toggleButtonEl = document.getElementById('toggleOptionsButton');
  buttonsEl.classList.contains('hidden') ? buttonsEl.classList.remove('hidden') : buttonsEl.classList.add('hidden');
  buttonsEl.classList.contains('hidden') ? toggleButtonEl.classList.add('collapsed') : toggleButtonEl.classList.remove('collapsed');
};

const showEditPanel = (event, id, view = 'sample') => {
  let data;
  if (view === 'opExport') {
    lastOpKit = files.filter(f => f.meta.checked);
    data = lastOpKit;
  } else {
    if (id && view !== 'opExport') {
      lastSelectedRow = getRowElementById(id);
    }
    data = getFileById(id || lastSelectedRow.dataset.id);
  }
  showEditor(
      data,
      {
        audioCtx,
        masterSR,
        masterChannels,
        masterBitDepth
      },
      view
  );
};

async function setWavLink(file, linkEl, renderAsAif) {
  let fileName = getNiceFileName('', file, false, true);
  let wav, blob;

  fileName = lastUsedAudioConfig.includes('a') ?
      fileName.replace('.wav', '.aif') :
      fileName;

  wav = audioBufferToWav(
      file.buffer, file.meta, masterSR, masterBitDepth, masterChannels, (renderAsAif && pitchModifier === 1), pitchModifier
  );
  blob = new window.Blob([new DataView(wav)], {
    type: renderAsAif && pitchModifier === 1 ? 'audio/aiff' : 'audio/wav',
  });
  if (pitchModifier !== 1) {
    let linkedFile = await fetch(URL.createObjectURL(blob));
    let arrBuffer = await linkedFile.arrayBuffer();
    let pitchedBuffer = await audioCtx.decodeAudioData(arrBuffer);
    let meta = {...file.meta};
    meta.slices = meta.slices.map(slice => ({
      ...slice,
      n: slice.n, s: Math.round(slice.s / pitchModifier),
      e: Math.round(slice.e / pitchModifier)
    }));
    wav = audioBufferToWav(
        pitchedBuffer, meta, masterSR, masterBitDepth, masterChannels, renderAsAif
    );
    blob = new window.Blob([new DataView(wav)], {
      type: renderAsAif ? 'audio/aiff' : 'audio/wav',
    });
  }

  linkEl.href = URL.createObjectURL(blob);
  linkEl.setAttribute('download', fileName);
  return blob;
}

async function downloadAll(event) {
  const _files = files.filter(f => f.meta.checked);
  const flattenFolderStructure = (event.shiftKey || modifierKeys.shiftKey);
  const links = [];
  const el = document.getElementById('getJoined');
  const renderAsAif = lastUsedAudioConfig.includes('a');
  if (_files.length > 5 && !zipDownloads) {
    const userReadyForTheCommitment = confirm(`You are about to download ${_files.length} files, that will show ${_files.length} pop-ups one after each other..\n\nAre you ready for that??`);
    if (!userReadyForTheCommitment) { return; }
  }
  document.getElementById('loadingText').textContent = 'Processing';
  document.body.classList.add('loading');

  if (zipDownloads && _files.length > 1) {
    const zip = new JSZip();
    for (const file of _files) {
      const blob = await setWavLink(file, el, renderAsAif);
      let fileName = '';
      fileName = lastUsedAudioConfig.includes('a') ?
          fileName.replace('.wav', '.aif') :
          fileName;
      if (flattenFolderStructure) {
        let fileName = getNiceFileName('', file, false, true);
        fileName = lastUsedAudioConfig.includes('a') ?
            fileName.replace('.wav', '.aif') :
            fileName;
        zip.file(fileName, blob, { binary: true });
      } else {
        let fileName = getNiceFileName('', file, false);
        fileName = lastUsedAudioConfig.includes('a') ?
            fileName.replace('.wav', '.aif') :
            fileName;
        zip.file(file.file.path + fileName, blob, { binary: true });
      }
    }
    zip.generateAsync({type: 'blob'}).then(blob => {
      const el = document.getElementById('getJoined');
      el.href = URL.createObjectURL(blob);
      el.setAttribute('download', 'digichain_files.zip');
      el.click();
      document.body.classList.remove('loading');
    });
    return;
  }

  for (const file of _files) {
    const link = await downloadFile(file.meta.id);
    links.push(link);
  }

  const intervalId = setInterval(() => {
    const lnk = links.shift();
    lnk?.click();
    if (links.length === 0 && lnk) {
      clearInterval(intervalId);
      document.body.classList.add('loading');
    }
  }, 500);

}

async function downloadFile(id, fireLink = false) {
  const el = getRowElementById(id).querySelector('.wav-link-hidden');
  const file = getFileById(id);
  const renderAsAif = lastUsedAudioConfig.includes('a');
  await setWavLink(file, el, renderAsAif);
  if (fireLink) {
    el.click();
  }
  return el;
}

function removeSelected() {
  metaFiles.removeSelected();
  //files.forEach(f => stopPlayFile(false, f.meta.id));
  files.filter(f => f.meta.checked).forEach(f => remove(f.meta.id));
  files = files.filter(f => !f.meta.checked);
  unsorted = unsorted.filter(id => files.find(f => f.meta.id === id));
  setCountValues();
  //renderList();
}

function normalizeSelected(event) {
  files.forEach(f => f.meta.checked ? f.source?.stop() : '' );
  document.getElementById('loadingText').textContent = 'Processing';
  document.body.classList.add('loading');
  setTimeout(() => {
    const selected = files.filter(f => f.meta.checked);
    selected.forEach((f, idx) => {
      editor.normalize(event, f, false);
      if (idx === selected.length - 1) {
        document.body.classList.remove('loading');
      }
    });
    renderList();
  }, 250);
}

function trimRightSelected(event) {
  files.forEach(f => f.meta.checked ? f.source?.stop() : '' );
  document.getElementById('loadingText').textContent = 'Processing';
  document.body.classList.add('loading');
  setTimeout(() => {
    const selected = files.filter(f => f.meta.checked);
    selected.forEach((f, idx) => {
      editor.trimRight(event, f, false);
      if (idx === selected.length - 1) {
        document.body.classList.remove('loading');
      }
    });
    renderList();
  }, 250);
}

function reverseSelected(event) {
  files.forEach(f => f.meta.checked ? f.source?.stop() : '' );
  document.getElementById('loadingText').textContent = 'Processing';
  document.body.classList.add('loading');
  setTimeout(() => {
    const selected = files.filter(f => f.meta.checked);
    selected.forEach((f, idx) => {
      editor.reverse(event, f, false);
      if (idx === selected.length - 1) {
        document.body.classList.remove('loading');
      }
    });
    renderList();
  }, 250);
}

function showInfo() {
  const description = document.querySelector('meta[name=description]').content;
  const infoPanelContentEl = document.querySelector('.info-panel-md .content');
  infoPanelContentEl.innerHTML = `
    <h3>DigiChain</h3>
    <p>${description}</p>
    <p class="float-right"><a href="https://brianbar.net/" target="_blank">Brian Barnett</a>
    (<a href="https://www.youtube.com/c/sfxBrian" target="_blank">sfxBrian</a> / <a href="https://github.com/brian3kb" target="_blank">brian3kb</a>) </p>
`;
  document.querySelector('.info-panel-md').classList.add('show');
}

function pitchExports(value, silent) {
  const octaves = {
    2: 1,
    4: 2,
    8: 3
  };
  if ([.25,.5,1,2,4,8].includes(+value)) {
    pitchModifier = +value;
    localStorage.setItem('pitchModifier', pitchModifier);
    infoEl.textContent = pitchModifier === 1 ? '' : `All exported samples will be pitched up ${octaves[pitchModifier]} octave${pitchModifier > 2 ? 's' : ''}`;
    if (silent) { return ; }
    showExportSettingsPanel();
  }
  return value;
}

function toggleSetting(param, value) {
  if (param === 'zipDl' ) {
    zipDownloads = !zipDownloads;
    localStorage.setItem('zipDownloads', zipDownloads);
    showExportSettingsPanel();
  }
  if (param === 'embedSliceData') {
    embedSliceData = !embedSliceData;
    localStorage.setItem('embedSliceData', embedSliceData);
    showExportSettingsPanel();
  }
  if (param === 'restoreLastUsedAudioConfig') {
    restoreLastUsedAudioConfig = !restoreLastUsedAudioConfig;
    localStorage.setItem('restoreLastUsedAudioConfig', restoreLastUsedAudioConfig);
    showExportSettingsPanel();
  }
  if (param === 'showTouchModifierKeys') {
    showTouchModifierKeys = !showTouchModifierKeys;
    localStorage.setItem('showTouchModifierKeys', showTouchModifierKeys);
    document.querySelector('.touch-buttons').classList[
        showTouchModifierKeys ? 'remove' : 'add'
        ]('hidden');
    showExportSettingsPanel();
  }
  if (param === 'playWithPopMarker' ) {
    playWithPopMarker = value;
    files.forEach(f => f.meta.peak = undefined);
    localStorage.setItem('playWithPopMarker', playWithPopMarker);
    showExportSettingsPanel();
  }
}

function setCustomSecondsPerFileValue(targetEl, size, silent = false) {
  let newValue = size;
  if (!silent) { newValue = prompt(`Change max seconds per file "${size}" to what new value?`); }
  if (newValue && !isNaN(newValue)) {
    newValue = Math.abs(Math.ceil(+newValue));
    secondsPerFile = +newValue;
    targetEl.textContent = newValue;
  }
  return +newValue;
};

function toggleSecondsPerFile(event, value) {
  const toggleEl = document.querySelector('.toggle-seconds-per-file');
  const toggleSpanEl = document.querySelector('.toggle-seconds-per-file span');
  if (event.ctrlKey || modifierKeys.ctrlKey) {
    value = setCustomSecondsPerFileValue(toggleSpanEl, secondsPerFile) || value;
  }
  if (value !== undefined) {
    secondsPerFile = value;
  } else {
    secondsPerFile = secondsPerFile === 0 ?
        (masterChannels === 2 ? 20 : 12):
        0;
  }
  if (secondsPerFile === 0) {
    toggleEl.classList.remove('on');
    toggleSpanEl.innerText = 'off';
  } else {
    toggleEl.classList.add('on');
    toggleSpanEl.innerText = `${secondsPerFile}s`;
    selectSliceAmount({
      shiftKey: true,
      target: document.querySelector('.slice-grid-off')
    }, 0);
  }
  setCountValues();
}

function changeOpParam(event, id, param, value) {
  const rowEl = getRowElementById(id);
  const item = getFileById(id);
  if (param === 'bal') {
    event.draggable = false;
    event.preventDefault();
    const balEl =  rowEl.querySelector('.channel-options-stereo-opf .channel-balance');
    let newValue = +event.target.value??16384;
    newValue = newValue - newValue%1024;
    item.meta.opPan = newValue;
  }
  if (param === 'baltoggle') {
    item.meta.opPanAb = !item.meta.opPanAb;
    rowEl.querySelector('.channel-options-stereo-opf').classList[
        item.meta.opPanAb ? 'add' : 'remove']('op-pan-ab-true');
  }
  return false;
}

function showExportSettingsPanel() {
  const panelContentEl = document.querySelector('.export-settings-panel-md .content');
  panelContentEl.innerHTML = `
    <h4>Settings</h4>
    <table style="padding-top:0;">
    <thead>
    <tr>
    <th width="55%"></th>
    <th></th>
</tr>
</thead>
    <tbody>
    <tr>
    <td><span>Pitch up exported files by octave &nbsp;&nbsp;&nbsp;</span></td>
    <td>    <button onclick="digichain.pitchExports(1)" class="check ${pitchModifier === 1 ? 'button' : 'button-outline'}">OFF</button>
    <button onclick="digichain.pitchExports(2)" class="check ${pitchModifier === 2 ? 'button' : 'button-outline'}">1</button>
    <button onclick="digichain.pitchExports(4)" class="check ${pitchModifier === 4 ? 'button' : 'button-outline'}">2</button>
    <button onclick="digichain.pitchExports(8)" class="check ${pitchModifier === 8 ? 'button' : 'button-outline'}">3</button><br></td>
</tr>
<tr>
<td><span>Restore the last used Sample Rate/Bit Depth/Channel? &nbsp;&nbsp;&nbsp;</span></td>
<td><button onclick="digichain.toggleSetting('restoreLastUsedAudioConfig')" class="check ${restoreLastUsedAudioConfig ? 'button' : 'button-outline'}">${ restoreLastUsedAudioConfig ? 'YES' : 'NO'}</button></td>
</tr>
    <tr>
    <td><span>Play pop markers when playing back samples?<br>0db prevents DT normalization.<br>Peak sets pop to loudest sample peak. &nbsp;&nbsp;&nbsp;</span></td>
    <td>
    <button onclick="digichain.toggleSetting('playWithPopMarker', 0)" class="check ${playWithPopMarker === 0 ? 'button' : 'button-outline'}">OFF</button>
    <button onclick="digichain.toggleSetting('playWithPopMarker', 1)" class="check ${playWithPopMarker === 1 ? 'button' : 'button-outline'}">0db</button>
    <button onclick="digichain.toggleSetting('playWithPopMarker', 2)" class="check ${playWithPopMarker === 2 ? 'button' : 'button-outline'}">Peak</button>
    </td>
    </tr>
<tr>
<td><span>Download multi-file/joined downloads as one zip file? &nbsp;&nbsp;&nbsp;</span></td>
<td><button onclick="digichain.toggleSetting('zipDl')" class="check ${zipDownloads ? 'button' : 'button-outline'}">${ zipDownloads ? 'YES' : 'NO'}</button></td>
</tr>
<tr>
<td><span>Embed slice information in exported wav files?<br>(Disable this if files cause an error loading for you.) &nbsp;&nbsp;&nbsp;</span></td>
<td><button onclick="digichain.toggleSetting('embedSliceData')" class="check ${embedSliceData ? 'button' : 'button-outline'}">${ embedSliceData ? 'YES' : 'NO'}</button></td>
</tr>
<tr>
<td><span>Show Shift/Ctrl modifier touch buttons?&nbsp;&nbsp;&nbsp;</span></td>
<td><button onclick="digichain.toggleSetting('showTouchModifierKeys')" class="check ${showTouchModifierKeys ? 'button' : 'button-outline'}">${ showTouchModifierKeys ? 'YES' : 'NO'}</button></td>
</tr>
</tbody>
</table>
<span class="settings-info">All settings here will persist when the app re-opens.</span>
  `;
  document.querySelector('.export-settings-panel-md').classList.add('show');
}

function getMonoFloat32ArrayFromBuffer(buffer, channel, getAudioBuffer = false) {
  let result = getAudioBuffer ?
      audioCtx.createBuffer(
          masterChannels,
          buffer.length,
          masterSR
      ) : new Float32Array(buffer.length);

  if (channel === 'S') {
    for (let i = 0; i < buffer.length; i++) {
      (getAudioBuffer ? result.getChannelData(0) : result)[i] = (buffer.getChannelData(0)[i] + buffer.getChannelData(1)[i]) / 2;
    }
  } else if(channel === 'D') {
    for (let i = 0; i < buffer.length; i++) {
      (getAudioBuffer ? result.getChannelData(0) : result)[i] = (buffer.getChannelData(0)[i] - buffer.getChannelData(1)[i]) / 2;
    }
  } else {
    const _channel = channel === 'R' ? 1 : 0;
    for (let i = 0; i < buffer.length; i++) {
      (getAudioBuffer ? result.getChannelData(0) : result)[i] = buffer.getChannelData(_channel)[i];
    }
  }
  return result;
}

function joinToMono(audioArrayBuffer, _files, largest, pad) {
  let totalWrite = 0;
  _files.forEach((file, idx) => {
    const bufferLength = pad ? largest : file.buffer.length;

    let result = getMonoFloat32ArrayFromBuffer(file.buffer, file?.meta?.channel);

    for (let i = 0; i < bufferLength; i++) {
      audioArrayBuffer.getChannelData(0)[totalWrite] = result[i];
      totalWrite++;
    }
  });
}

function joinToStereo(audioArrayBuffer, _files, largest, pad) {
  let totalWrite = 0;
  _files.forEach((file, idx) => {
    const bufferLength = pad ? largest : file.buffer.length;
    let result = [new Float32Array(file.buffer.length), new Float32Array(file.buffer.length)];

    for (let i = 0; i < file.buffer.length; i++) {
      result[0][i] = file.buffer.getChannelData(0)[i];
      result[1][i] = file.buffer.getChannelData(file.buffer.numberOfChannels === 2 ? 1 : 0)[i];
    }

    for (let i = 0; i < bufferLength; i++) {
      audioArrayBuffer.getChannelData(0)[totalWrite] = result[0][i];
      audioArrayBuffer.getChannelData(1)[totalWrite] = result[1][i];
      totalWrite++;
    }
  });
}
//TODO: Finish mix-down method.
function mixDown(_files) {
  const mixDownLength = _files.reduce((big, cur) => big > cur.buffer.length ? big : cur.buffer.length, 0);
  const audioArrayBuffer = audioCtx.createBuffer(
      masterChannels,
      mixDownLength,
      masterSR
  );
  let totalWrite = 0;
  _files.forEach((file, idx) => {
    const bufferLength = pad ? largest : file.buffer.length;
    let result = [new Float32Array(file.buffer.length), new Float32Array(file.buffer.length)];

    for (let i = 0; i < file.buffer.length; i++) {
      result[0][i] = file.buffer.getChannelData(0)[i];
      result[1][i] = file.buffer.getChannelData(file.buffer.numberOfChannels === 2 ? 1 : 0)[i];
    }

    for (let i = 0; i < bufferLength; i++) {
      audioArrayBuffer.getChannelData(0)[totalWrite] = result[0][i];
      audioArrayBuffer.getChannelData(1)[totalWrite] = result[1][i];
      totalWrite++;
    }
  });
}

function showMergePanel() {
  const mergePanelEl = document.getElementById('mergePanel');
  const mergePanelContentEl = document.getElementById('mergePanelContent');
  mergeFiles = files.filter(f => f.meta.checked).map(f => {
    f.meta.pan = f.meta.pan || 'C';
    return f;
  });
  if (mergeFiles.length < 2) {
    return alert('Merge requires more than one file to be selected.');
  }

  mergePanelContentEl.innerHTML = `
     <div class="row">
     <div class="column mh-60vh">
       <table id="mergeList">
        <thead>
          <tr>
          <th>Filename</th>
          <th>Duration</th>
          <th>Mono Channel Choice</th>
          <th>Panning</th>
          </tr>
        </thead>
      <tbody>
  ` + mergeFiles.map(mf => buildRowMarkupFromFile(mf, 'merge')).join('') +
      `</tbody>
     </table>
   </div>
  </div>
  <span class="merge-info">Merging flattens each source sample to mono based on the mixdown choice and pans that mono file hard left/right or centers. If you want to retain a stereo files stereo field in the merge, duplicate it first and choose its L/R mix.</span>
  <button class="float-right" onclick="digichain.performMergeUiCall()">Merge Files</button>
  `;
  mergePanelEl.classList.add('show');
}

function performMergeUiCall() {
  const mergePanelEl = document.getElementById('mergePanel');
  document.getElementById('loadingText').textContent = 'Processing';
  document.body.classList.add('loading');
  if (files.filter(f => f.meta.checked).length === 0) {
    return ;
  }
  mergePanelEl.classList.remove('show');
  setTimeout(() => performMerge(mergeFiles), 100);
}

function performMerge(mFiles) {
  let longest = mFiles[0];
  mFiles.forEach(mf => longest = longest.buffer.length > mf.buffer.length ? longest : mf);
  let newItem = {
    file: {...longest.file},
    buffer: audioCtx.createBuffer(
        2,
        longest.buffer.length,
        masterSR
    ),
    meta: {...longest.meta, channel: 'L', isMerge: true, editOf: '', id: crypto.randomUUID(), checked: false },
    waveform: false
  };
  for (let i = 0; i < newItem.buffer.length; i++) {
    newItem.buffer.getChannelData(0)[i] = 0;
    newItem.buffer.getChannelData(1)[i] = 0;
  }
  mFiles.forEach((mf, idx) => {
    const panChannel = mf.meta.pan === 'L' ? 0 : 1;
    let data = mf.buffer.getChannelData(0);
    if (mf.buffer.numberOfChannels === 2) {
      data = getMonoFloat32ArrayFromBuffer(mf.buffer, mf.meta?.channel);
    }
    if (mf.meta.pan === 'C'){
      for (let i = 0; i < mf.buffer.length; i++) {
        newItem.buffer.getChannelData(0)[i] = (newItem.buffer.getChannelData(0)[i] + data[i]) / 2;
        newItem.buffer.getChannelData(1)[i] = (newItem.buffer.getChannelData(1)[i] + data[i]) / 2;
      }
    } else {
      const buffer = newItem.buffer.getChannelData(panChannel);
      for (let i = 0; i < mf.buffer.length; i++) {
        newItem.buffer.getChannelData(panChannel)[i] = buffer[i] === 0 ?
            data[i] :
            ((buffer[i] + data[i]) / 2);
      }
    }

    if (idx === mFiles.length - 1) {
      files.unshift(newItem);
      unsorted.push(newItem.meta.id);
      document.body.classList.remove('loading');
      renderList();
    }
  });

}

function joinAllUICall(event, pad) {
  if (files.length === 0) { return; }
  document.getElementById('loadingText').textContent = 'Processing';
  document.body.classList.add('loading');
  setTimeout(() => joinAll(event, pad), 500);
}

async function joinAll(event, pad = false, filesRemaining = [], fileCount = 0, toInternal = false, zip = false) {
  if (files.length === 0) { return; }
  if (toInternal || (event.shiftKey || modifierKeys.shiftKey)) { toInternal = true; }
  if (zipDownloads && !toInternal) { zip = zip || new JSZip(); }

  let _files = filesRemaining.length > 0 ? filesRemaining : files.filter(f => f.meta.checked);

  let tempFiles, slices, largest;
  let totalLength = 0;

  if (secondsPerFile === 0) { /*Using slice grid file lengths*/
    tempFiles = _files.splice(0, (sliceGrid > 0 ? sliceGrid : _files.length));

    filesRemaining = Array.from(_files);
    _files = tempFiles;
    if (pad && sliceGrid !== 0 && _files.length !== 0) {
      while (_files.length !== sliceGrid) {
        _files.push(_files[_files.length - 1]);
      }
    }
    largest = _files.reduce((big, cur) => big > cur.buffer.length ? big : cur.buffer.length, 0);
    totalLength = _files.reduce((total, file) => {
      total +=  pad ? largest : file.buffer.length;
      return total;
    }, 0);

  } else { /*Using max length in seconds file lengths upto 24 files*/
    const processing = _files.reduce((a, f) => {
      if (
          (a.duration + +f.meta.duration <= (secondsPerFile * pitchModifier)) &&
          (a.processed.length < 24)) {
        a.duration = a.duration + +f.meta.duration;
        a.totalLength = a.totalLength + +f.meta.length;
        a.processed.push(f);
      } else {
        a.skipped.push(f);
      }
      return a;
    }, { duration: 0, totalLength: 0, processed: [], skipped: [] });

    totalLength = processing.totalLength;
    filesRemaining = processing.skipped;
    _files = processing.processed;
  }

  if (embedSliceData) {
    slices = [];
    let offset = 0;
    for (let x = 0; x < _files.length; x++) {
      if (_files[x].meta.slices) {
        if (slices.length > 0) {
          const _slices = JSON.parse(JSON.stringify(_files[x].meta.slices));
          _slices.forEach(slice => {
            slice.s = slice.s + offset;
            slice.e = slice.e + offset;
          });
          slices = [...slices, ..._slices];
        } else {
          slices = [...slices, ..._files[x].meta.slices];
        }
      } else {
        slices.push({
          s: offset,
          e: offset + (pad ? largest : +_files[x].buffer.length),
          n: _files[x].file.name,
          p: _files[x].meta.opPan??16384,
          pab: _files[x].meta.opPanAb??false,
          st: _files[x].meta.opPitch??0
        });
      }
      offset += +_files[x].buffer.length;
    }
  }

  const audioArrayBuffer = audioCtx.createBuffer(
      masterChannels,
      totalLength,
      masterSR
  );

  if (masterChannels === 1) { joinToMono(audioArrayBuffer, _files, largest, pad); }
  if (masterChannels === 2) { joinToStereo(audioArrayBuffer, _files, largest, pad); }

  const joinedEl = document.getElementById('getJoined');
  const path = _files[0].file.path ? `${(_files[0].file.path || '').replace(/\//gi, '-')}` : '';
  const fileData = {file: {
    name: _files.length === 1 ?
        `${path}joined_${pad ? 'spaced_' : ''}${getNiceFileName('', _files[0], true)}_${fileCount+1}--[${_files.length}].wav` :
        `${path}joined_${pad ? 'spaced_' : ''}${fileCount+1}--[${_files.length}].wav`
    }, buffer: audioArrayBuffer, meta: { slices }};
  if (toInternal) {

      const blob = await setWavLink(fileData, joinedEl);
      const fileReader = new FileReader();
      fileReader.readAsArrayBuffer(blob);
      fileReader.fileCount = fileCount;

      fileReader.onload = (e) => {
        const fb = e.target.result.slice(0);
        audioCtx.decodeAudioData(e.target.result, function(buffer) {
          parseWav(buffer, fb, {
            lastModified: new Date().getTime(),
            slices: slices,
            name: _files.length === 1 ?
                `${path}resample_${pad ? 'spaced_' : ''}${getNiceFileName('', _files[0], true)}_${fileReader.fileCount+1}--[${_files.length}].wav`:
                `${path}resample_${pad ? 'spaced_' : ''}${fileReader.fileCount+1}--[${_files.length}].wav`,
            size: ((masterBitDepth * masterSR * (buffer.length / masterSR)) / 8) * buffer.numberOfChannels /1024,
            type: 'audio/wav'
          }, '', true, false);
          renderList();
        })
      };

  } else {
    const renderAsAif = lastUsedAudioConfig.includes('a');
      if (zip) {
        const blob = setWavLink(fileData, joinedEl, renderAsAif);
        fileData.file.name = lastUsedAudioConfig.includes('a') ?
            fileData.file.name.replace('.wav', '.aif') :
            fileData.file.name;
        zip.file(fileData.file.name, blob, { binary: true });
      } else {
        await setWavLink(fileData, joinedEl, renderAsAif);
        joinedEl.click();
      }
  }
  if (filesRemaining.length > 0) {
    fileCount++;
    joinAll(event, pad, filesRemaining, fileCount, toInternal, zip);
  } else {
    if (zip) {
      zip.generateAsync({type: 'blob'}).then(blob => {
        joinedEl.href = URL.createObjectURL(blob);
        joinedEl.setAttribute('download', 'digichain_files.zip');
        joinedEl.click();
      });
    }
    renderList();
  }
}

function joinAllByPath(event, pad = false) { //TODO: test and hook into UI
  const filesByPath = {};
  files.filter(f => f.meta.checked).forEach(file => {
    const path = file.file.path.replace(/\//gi, '-');
    filesByPath[path] = filesByPath[path] || [];
    filesByPath[path].push(file);
  });
  for (const fBP of filesByPath) {
    joinAll(event, pad, fBP,fBP.length);
  }
}

const stopPlayFile = (event, id) => {
  const file = getFileById(id || lastSelectedRow?.dataset?.id);
  if (!file) { return ; }
    file?.source?.stop();
    if (file.meta.playing && file.meta.playing !== true) {
      const [fnType, fnId] = file.meta.playing.split('_');
      window['clear' + fnType](+fnId);
      file.meta.playing = false;
      file.playHead?.remove();
      file.playHead = false;
    }
    file.waveform?.classList?.remove('playing');
    let playHead = file.playHead || file.waveform?.parentElement?.querySelector('.play-head');
    if (playHead) { playHead.remove(); }
};

const playFile = (event, id, loop) => {
  const file = getFileById(id || lastSelectedRow.dataset.id);
  let playHead;
  loop = loop || (event.shiftKey || modifierKeys.shiftKey) || false;

  stopPlayFile(false, (id || file.meta.id));

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  file.source = audioCtx.createBufferSource();
  let buffer = file.meta.channel && masterChannels === 1 ?
      getMonoFloat32ArrayFromBuffer(file.buffer, file.meta.channel, true) :
      file.buffer;

  if (playWithPopMarker && !event?.editor) {
    const popAudio = audioCtx.createBuffer(1, 8, masterSR);
    const popBuffer = audioCtx.createBuffer(buffer.numberOfChannels, buffer.length + (popAudio.length * 2), masterSR);
    const popData = popAudio.getChannelData(0);
    let peak;
    if (playWithPopMarker === 2) {
      peak = file.meta.peak??editor.normalize(event, file, false, true);
    } else {
      peak = 1;
    }
    new Array(popAudio.length).fill(0).forEach((x, i) => popAudio.getChannelData(0)[i] = peak);
    for(let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      popBuffer.copyToChannel(popData, channel);
      popBuffer.copyToChannel(channelData, channel, popAudio.length);
      popBuffer.copyToChannel(popData, channel, popAudio.length + channelData.length);
    }
    buffer = popBuffer;
  }

  file.source.buffer = buffer;
  file.source.connect(audioCtx.destination);
  file.source.loop = loop;

  if (id && !event?.editor){
    playHead = document.createElement('span');
    playHead.classList.add('play-head');
    playHead.style.animationDuration = `${file.meta.duration}s`;
    file.waveform.parentElement.appendChild(playHead);
    file.playHead = playHead;
  }

  file.source.start();

  if (id && !event?.editor) {
    playHead.style.animationIterationCount = file.source.loop ? 'infinite' : 'unset';
    file.waveform?.classList?.add('playing');

    if (file.source.loop) {
      file.meta.playing = 'Interval_' + setInterval(() => {
        const ph = file.waveform?.parentElement?.querySelector('.play-head');
        if (ph) {
          const phClone = ph.cloneNode(true);
          ph.remove();
          file.waveform.parentElement.appendChild(phClone);
        } else { // Buffer modified while playing, so clear out the meta.
          stopPlayFile(false, file.meta.id);
        }
      }, file.meta.duration * 1000);
    } else {
      file.meta.playing = 'Timeout_' + setTimeout(() => {
        stopPlayFile(false, file.meta.id);
      }, file.meta.duration * 1000);
    }
  }

};

const toggleCheck = (event, id) => {
  try {
    const rowEl = getRowElementById(id);
    const el = getRowElementById(id).querySelector('.toggle-check');
    const file = getFileById(id);
    event.preventDefault();
    file.meta.checked = !file.meta.checked;
    file.meta.checked
        ? el.classList.remove('button-outline')
        : el.classList.add('button-outline');
    file.meta.checked
        ? rowEl.classList.add('checked')
        : rowEl.classList.remove('checked');
    if (!file.meta.checked) {
      file.source?.stop();
    }
    lastSort = '';
    setCountValues();
  } catch (err) {
    setCountValues();
  }
};

const changeChannel = (event, id, channel, allowModKey = true, tableId = '#masterList') => {
  const el = getRowElementById(id, tableId).querySelector('.channel-option-' + channel);
  const file = getFileById(id);
  if ((event.shiftKey || modifierKeys.shiftKey) && allowModKey) {
    const opts = {
      L: 'audio from the Left channel',
      R: 'audio from the Right channel',
      S: 'Sum both channels of audio to mono',
      D: 'Difference between Left and Right channels'
    };
    const confirmSetAllSelected = confirm(`Confirm setting all selected samples that are stereo to ${opts[channel]}?`);
    if (confirmSetAllSelected) {
      files.filter(f => f.meta.checked).forEach(f => {
        f.meta.channel = channel;
      });
    }
    if (!modifierKeys.shiftKey && document.body.classList.contains('shiftKey-down')) {
      document.body.classList.remove('shiftKey-down');
    }
    return renderList();
  }
  file.meta.channel = channel;
  //file.waveform.getContext('2d').clear();
  //drawWaveform(file, file.waveform, file.buffer.numberOfChannels);
  getRowElementById(id, tableId).querySelectorAll('.channel-options a').forEach(opt => opt.classList.remove('selected'));
  el.classList.add('selected');
};

const changePan = (event, id, pan) => {
  const el = getRowElementById(id, '#mergeList').querySelector('.pan-option-' + pan);
  const file = getFileById(id);
  file.meta.pan = pan;
  //file.waveform.getContext('2d').clear();
  //drawWaveform(file, file.waveform, file.buffer.numberOfChannels);
  getRowElementById(id, '#mergeList').querySelectorAll('.pan-options a').forEach(opt => opt.classList.remove('selected'));
  el.classList.add('selected');
};

const invertFileSelection = () => {
  if (files.length === 0) { return ; }
  files.forEach(file => file.meta.checked = !file.meta.checked);
  renderList();
};

const changeSliceOption = (targetEl, size, silent = false) => {
  let newValue = size;
  if (!silent) { newValue = prompt(`Change slice value "${size}" to what new value?`); }
  if (newValue && !isNaN(newValue)) {
    newValue = Math.abs(Math.ceil(+newValue));
    sliceOptions[targetEl.dataset.sel] = +newValue;
    targetEl.textContent = newValue;
  }
  return +newValue;
};

const selectSliceAmount = (event, size) => {
  if (!event.target) { return ; }
  if ((event.ctrlKey || modifierKeys.ctrlKey)) {
    if (size === 0) {
      DefaultSliceOptions.forEach((option, index) => changeSliceOption(
          document.querySelector(`.master-slices .sel-${index}`), option, true
      ));
      sliceOptions = Array.from(DefaultSliceOptions);
      return selectSliceAmount({ shiftKey: true }, 0);
    }
    return selectSliceAmount({ shiftKey: true }, changeSliceOption(event.target, size));
  }
  sliceGrid = size;
  sliceOptions.forEach((option, index) => {
    const el = document.querySelector(`.master-slices .sel-${index}`);
    option === size ?
        el.classList.remove('button-outline') :
        el.classList.add('button-outline');
  });
  setCountValues();
  if (size === 0) {
    files.forEach(f => f.source?.stop());
  }
  if ((event.shiftKey || modifierKeys.shiftKey)) { return; } /*Shift-click to change grid but keep selections.*/
  files.forEach(f => f.meta.checked = false);
  for (let i = 0; i < (size < files.length ? size : files.length) ; i++) {
    toggleCheck(event, files[i].meta.id);
  }
  renderList();
}

const duplicate = (event, id, prepForEdit = false) => {
  const file = getFileById(id);
  const fileIdx = getFileIndexById(id) + 1;
  const item = {file: {...file.file}};
  item.buffer = new AudioBuffer({
    numberOfChannels: file.buffer.numberOfChannels,
    length: file.buffer.length,
    sampleRate: file.buffer.sampleRate
  });
  for (let channel = 0; channel < file.buffer.numberOfChannels; channel++) {
    const ogChannelData = file.buffer.getChannelData(channel);
    const newChannelData = item.buffer.getChannelData(channel);
    newChannelData.set(ogChannelData);
  }
  item.meta = JSON.parse(JSON.stringify(file.meta)); // meta sometimes contains a customSlices object.
  item.waveform = false;
  item.meta.playing = false;
  item.meta.id = crypto.randomUUID();
  if (prepForEdit) {
    item.meta.editOf = id;
    return {
      item,
      fileIdx,
      callback: (_item, _fileIdx) => {
        files.splice(((event.shiftKey || modifierKeys.shiftKey) ? files.length : _fileIdx), 0, _item);
        unsorted.push(_item.meta.id);
        renderList();
      }
    };
  }
  item.meta.dupeOf = id;
  files.splice(((event.shiftKey || modifierKeys.shiftKey) ? files.length : fileIdx), 0, item);
  unsorted.push(item.meta.id);
  renderList();
};

function splitFromFile(input) {
  const trackButtonsContainerEl = document.querySelector('.slice-from-file-buttons');
  const trackButtonsEl = document.querySelectorAll('.slice-from-file-buttons button');
  if (!input.target?.files?.length) { return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    if (!e.target.result) { return ; }
    const json = JSON.parse(e.target.result);
    if (!json.clips) { return ; }
    lastSliceFileImport = json.clips.map(clip => ({
      track: clip.ch + 1,
      startPoint: Math.round((clip.start / 44100) * masterSR),
      endPoint: Math.round((clip.stop / 44100) * masterSR)
    }));
    lastSliceFileImport.trackSlices = {};
    lastSliceFileImport.forEach(
        slice => lastSliceFileImport.trackSlices[`t${slice.track}`] = (lastSliceFileImport.trackSlices[`t${slice.track}`]??0) + 1 )
    trackButtonsContainerEl.classList.remove('hidden');
    trackButtonsEl.forEach((btn, i) => btn.textContent = `${lastSliceFileImport.trackSlices[`t${i+1}`]}`);
  };
  reader.readAsText(input.target.files[0]);
}

function splitFromTrack(event, track) {
  const sliceGroupEl = document.querySelector(`.split-panel-options .slice-group`);
  const file = getFileById(sliceGroupEl.dataset.id);
  file.meta.customSlices = {slices: lastSliceFileImport.filter(slice => slice.track === track)};
  file.meta.customSlices.sliceCount = file.meta.customSlices.slices.length;
  drawSliceLines(file.meta.customSlices.length, file, file.meta.customSlices);
}

const splitByOtSlices = (event, id, pushInPlace = false, sliceSource = 'ot') => {
  const file = getFileById(id);
  const pushInPlaceItems = [];
  let otMeta;
  if (sliceSource === 'transient') {
    otMeta = metaFiles.getByFileName('---sliceToTransientCached---');
  } else if (sliceSource === 'ot') {
    otMeta = metaFiles.getByFile(file);
  } else {
    otMeta = file.meta.customSlices ? file.meta.customSlices : false;
  }
  if (!otMeta) { return ; }
  for (let i = 0; i < otMeta.sliceCount; i++) {
    const newLength = (otMeta.slices[i].endPoint - otMeta.slices[i].startPoint);
    if (newLength < 5) { continue; }
    const audioArrayBuffer = audioCtx.createBuffer(
        file.buffer.numberOfChannels,
        newLength,
        masterSR
    );
    const slice = {};
    const uuid = crypto.randomUUID();
    slice.buffer = audioArrayBuffer;
    slice.file = {...file.file};
    if (otMeta.slices[i].name) {
      slice.file.name = otMeta.slices[i].name;
    }
    slice.meta = {
      length: audioArrayBuffer.length,
      duration: Number(audioArrayBuffer.length / masterSR).toFixed(3),
      startFrame: 0, endFrame: audioArrayBuffer.length,
      checked: true, id: uuid,
      sliceNumber: `${file.meta.sliceNumber ? file.meta.sliceNumber + '-' : ''}${i+1}`, slicedFrom: file.meta.id,
      channel: audioArrayBuffer.numberOfChannels > 1 ? 'L': ''
    };
    slice.meta.customSlices = false;
    slice.meta.op1Json = false;
    slice.meta.slices = false;

    file.buffer.getChannelData(0).slice(otMeta.slices[i].startPoint, otMeta.slices[i].endPoint).forEach((a, idx) => slice.buffer.getChannelData(0)[idx] = a);
    if (file.buffer.numberOfChannels === 2) {
      file.buffer.getChannelData(1).slice(otMeta.slices[i].startPoint, otMeta.slices[i].endPoint).forEach((a, idx) => slice.buffer.getChannelData(1)[idx] = a);
    }
    if (pushInPlace) {
      pushInPlaceItems.push(slice);
    } else {
      files.push(slice);
    }
    unsorted.push(uuid);
  }
  if (pushInPlaceItems.length) {
    files.splice(getFileIndexById(id) + 1, 0, ...pushInPlaceItems);
  }
  renderList();
};

const splitEvenly = (event, id, slices, pushInPlace = false) => {
  const file = getFileById(id);
  const frameSize = file.buffer.length / slices;
  const pushInPlaceItems = [];
  for (let i = 0; i < slices; i++) {
    const audioArrayBuffer = audioCtx.createBuffer(
        file.buffer.numberOfChannels,
        frameSize,
        file.buffer.sampleRate
    );
    const slice = {};
    const uuid = crypto.randomUUID();
    slice.buffer = audioArrayBuffer;
    slice.file = {...file.file};
    slice.meta = {
      length: audioArrayBuffer.length,
      duration: Number(audioArrayBuffer.length / masterSR).toFixed(3),
      startFrame: 0, endFrame: audioArrayBuffer.length,
      checked: true, id: uuid,
      sliceNumber: `${file.meta.sliceNumber ? file.meta.sliceNumber + '-' : ''}${i+1}`, slicedFrom: file.meta.id,
      channel: audioArrayBuffer.numberOfChannels > 1 ? 'L': ''
    };

    file.buffer.getChannelData(0).slice((i * frameSize), (i * frameSize) + frameSize).forEach((a, idx) => slice.buffer.getChannelData(0)[idx] = a);
    if (file.buffer.numberOfChannels === 2) {
      file.buffer.getChannelData(1).slice((i * frameSize), (i * frameSize) + frameSize).forEach((a, idx) => slice.buffer.getChannelData(1)[idx] = a);
    }
    if (pushInPlace) {
      pushInPlaceItems.push(slice);
    } else {
      files.push(slice);
    }
    unsorted.push(uuid);
  }
  if (pushInPlaceItems.length) {
    files.splice(getFileIndexById(id) + 1, 0, ...pushInPlaceItems);
  }
  renderList();
}

const splitByTransient = (file, threshold = .8) => {
  const transientPositions = [];
  const frameSize = Math.floor(file.buffer.length / 256);
  let lastStart = undefined;
  let lastEnd = undefined;
  for (let i = 0; i < file.buffer.length; i++) {
    if (lastStart === undefined) {
      if (Math.abs(file.buffer.getChannelData(0)[i]) > threshold) {
        lastStart = i;
        i = i + frameSize;
      }
    } else {
      if (lastEnd === undefined) {
        // I want loose equality here as I want 0.000 to be true against 0
        if (Math.abs(file.buffer.getChannelData(0)[i]).toFixed(3) == 0 || i + frameSize > file.buffer.length) {
          //lastEnd =  i + frameSize > file.buffer.length ? i : i + frameSize;
          lastEnd = i;
        }
      }
    }

    if (lastStart !== undefined && lastEnd !== undefined) {
      transientPositions.push({
        startPoint: lastStart,
        loopPoint: lastStart,
        endPoint: lastEnd
      });
      lastStart = undefined;
      lastEnd = undefined;
    }
  }

// map transient positions into slice object.
  let metaTransient = metaFiles.getByFileName('---sliceToTransientCached---');

  metaTransient.slices = transientPositions;
  metaTransient.sliceCount = metaTransient.slices.length;
  return metaTransient;
};

const splitSizeAction = (event, slices, threshold) => {
  let file, otMeta;
  const sliceGroupEl = document.querySelector(`.split-panel-options .slice-group`);
  const optionsEl = document.querySelectorAll(`.split-panel-options .slice-group button`);

  if (slices === 'ot' && sliceGroupEl.dataset.id) {
    file = getFileById(sliceGroupEl.dataset.id);
    otMeta = metaFiles.getByFile(file);
    slices = otMeta.slices;
  }
  if (slices === 'transient' && sliceGroupEl.dataset.id) {
    file = getFileById(sliceGroupEl.dataset.id);
    otMeta = splitByTransient(file, (+threshold)/100);
    slices = otMeta.slices;
  } else {
    metaFiles.removeByName('---sliceToTransientCached---');
  }

  optionsEl.forEach(option => option.classList.add('button-outline'));
  sliceGroupEl.dataset.sliceCount = typeof slices === 'number' ? slices : otMeta.sliceCount;
  optionsEl.forEach((option, index) => {
    (+option.dataset.sel === +sliceGroupEl.dataset.sliceCount && !otMeta) || (option.dataset.sel === 'ot' && otMeta && otMeta.name !== '---sliceToTransientCached---') || (option.dataset.sel === 'transient' && otMeta && otMeta.name === '---sliceToTransientCached---') ?
        option.classList.remove('button-outline') :
        option.classList.add('button-outline');
  });
  drawSliceLines(slices, file, otMeta);
  if (file?.meta?.customSlices) {
    file.meta.customSlices = false;
  }
};

const remove = (id) => {
  stopPlayFile(false, id);
  const rowEl = getRowElementById(id);
  const fileIdx = getFileIndexById(id);
  const removed = files.splice(fileIdx, 1);
  const unsortIdx = unsorted.findIndex(uuid => uuid === id);
  unsorted.splice(unsortIdx, 1);
  if (removed[0]) {
    metaFiles.removeByName(removed[0].file.name);
  }
  rowEl.classList.add('hide');
  rowEl.remove();
}

const move = (event, id, direction) => {
  const from = getFileIndexById(id);
  let item;
  let to = direction === 1 ? (from + 1) : (from - 1);
  if (to === -1) { to = files.length - 1; }
  if (to >= files.length) { to = 0; }
  item = files.splice(from, 1)[0];
  if ((event.shiftKey || modifierKeys.shiftKey)) { /*If shift key, move to top or bottom of list.*/
    from > to ? files.splice(0, 0, item): files.splice(files.length, 0, item);
  } else {
    files.splice(to, 0, item);
  }
  renderList();
};
const sort = (event, by) => {
  const groupByChecked = (event.shiftKey || modifierKeys.shiftKey);
  if (by === 'id') {
    if (groupByChecked === true) {
      files.sort(() => crypto.randomUUID().localeCompare(crypto.randomUUID()));
    } else {
      files = unsorted.map(key => files.find(f => f.meta.id === key));
      lastSort = '';
    }
  } else {
    if (lastSort === by) {
      //files.reverse();
      files = by === 'name' ?
          files.sort((a, b) => b.file[by].localeCompare(a.file[by])) :
          files.sort((a, b) => (b.meta[by] - a.meta[by]));
      lastSort = '';
    } else {
      files = by === 'name' ?
          files.sort((a, b) => a.file[by].localeCompare(b.file[by])) :
          files.sort((a, b) => (a.meta[by] - b.meta[by]));
      lastSort = by;
    }
  }
  if (groupByChecked === true && by !== 'id') {
    files.sort((a, b) => (b.meta.checked - a.meta.checked));
  }
  renderList();
};

const handleRowClick = (event, id) => {
  const row = getRowElementById(id);
  if (document.querySelector('.pop-up.show')) { return ; }
  if (lastSelectedRow) { lastSelectedRow.classList.remove('selected'); }
  row.classList.add('selected');
  lastSelectedRow = row;
  lastSelectedRow.scrollIntoViewIfNeeded();
  setCountValues();

};

const rowDragStart = (event) => {
  if (event.target?.classList?.contains('file-row')) {
    lastSelectedRow = event.target;
  }
};

const drawSliceLines = (slices, file, otMeta) => {
  const _slices = typeof slices === 'number' ? Array.from('.'.repeat(slices)) : slices;
  const sliceLinesEl = document.getElementById('sliceLines');
  const splitPanelWaveformContainerEl = document.querySelector(`#splitOptions .waveform-container`);
  const waveformWidth = splitPanelWaveformContainerEl.dataset.waveformWidth;
  let lines = [];
  if (file && otMeta) {
    let scaleSize = file.buffer.length/waveformWidth;
    lines = otMeta.slices.map((slice, idx) => `
        <div class="line" style="margin-left:${(slice.startPoint/scaleSize)}px; width:${(slice.endPoint/scaleSize) - (slice.startPoint/scaleSize)}px;"></div>
    `);
  } else {
    lines = _slices.map((slice, idx) => `
      <div class="line" style="margin-left:${(waveformWidth/_slices.length) * idx}px; width:${(waveformWidth/_slices.length)}px;"></div>
  `);
    //
    // lines = _slices.map((slice, idx) => `
    //   <div class="line" onclick="digichain.selectSlice(event)" style="margin-left:${(waveformWidth/_slices.length) * idx}px; width:${(waveformWidth/_slices.length)}px;"></div>
    // `);
  }
  sliceLinesEl.innerHTML = lines.join('');
};

const splitAction = (event, id, slices) => {
  const el = document.getElementById('splitOptions');
  const fileNameEl = document.getElementById('splitFileName');
  const sliceGroupEl = document.querySelector(`.split-panel-options .slice-group`);
  const sliceByOtButtonEl = document.getElementById('sliceByOtButton');
  const sliceByTransientButtonEl = document.getElementById('sliceByTransientButton');
  const sliceByTransientThresholdEl = document.getElementById('transientThreshold');
  const splitPanelWaveformContainerEl = document.querySelector(`#splitOptions .waveform-container`);
  const splitPanelWaveformEl = document.getElementById('splitPanelWaveform');
  let item;
  let otMeta;
  let pushInPlace = (event.shiftKey || modifierKeys.shiftKey);
  if (id) {
    lastSelectedRow = getRowElementById(id);
    sliceGroupEl.dataset.id = id;
  }
  if (slices === true) { slices = sliceGroupEl.dataset.sliceCount; }
  item = getFileById(id || lastSelectedRow.dataset.id);
  if (slices) {
    id = id || item.meta.id;
    if (slices === 'ot' || !sliceByTransientButtonEl.classList.contains('button-outline') || !sliceByOtButtonEl.classList.contains('button-outline')) {
      const sliceSource = sliceByTransientButtonEl.classList.contains('button-outline') ? 'ot' : 'transient';
      splitByOtSlices(event, id, pushInPlace, sliceSource);
    } else {
      if (item.meta.customSlices) {
        splitByOtSlices(event, id, pushInPlace, 'custom');
      } else {
        splitEvenly(event, id, slices, pushInPlace);
      }
    }
    return el.classList.remove('show');
  }
  otMeta = metaFiles.getByFile(item);
  fileNameEl.textContent = getNiceFileName('', item, true);
  sliceByOtButtonEl.style.display = otMeta ? 'inline-block' : 'none';
  sliceByOtButtonEl.textContent = otMeta ? `${otMeta.sliceCount}` : 'OT';
  if (otMeta?.cssClass === 'is-op-file') {
    sliceByOtButtonEl.classList.remove('is-ot-file');
    sliceByOtButtonEl.classList.remove('is-dc-file');
    sliceByOtButtonEl.classList.add('is-op-file');
  } else if (otMeta?.cssClass === 'is-dc-file') {
    sliceByOtButtonEl.classList.remove('is-ot-file');
    sliceByOtButtonEl.classList.remove('is-op-file');
    sliceByOtButtonEl.classList.add('is-dc-file');
  } else {
    sliceByOtButtonEl.classList.add('is-ot-file');
    sliceByOtButtonEl.classList.remove('is-op-file');
    sliceByOtButtonEl.classList.remove('is-dc-file');
  }
  splitSizeAction(false,0);
  el.classList.add('show');
  drawWaveform(item, splitPanelWaveformEl, item.meta.channel, {
    width: +splitPanelWaveformContainerEl.dataset.waveformWidth, height: 128
  });
  item.meta.customSlices = false;
};

const secondsToMinutes = (time) => {
  const mins =  Math.floor(time / 60);
  const seconds = Number(time % 60).toFixed(2);
  return  mins > 0 ? `${mins}m ${Math.round(+seconds)}s` : `${seconds}s`;
};

const clearModifiers = () => {
  modifierKeys.shiftKey = false;
  modifierKeys.ctrlKey = false;
  document.body.classList.remove('shiftKey-down');
  document.body.classList.remove('ctrlKey-down');
};

const setCountValues = () => {
  const filesSelected = files.filter(f => f.meta.checked);
  const selectionCount = filesSelected.length;
  const filesDuration = files.reduce((a, f) => a += +f.meta.duration, 0);
  const filesSelectedDuration = filesSelected.reduce((a, f) => a += +f.meta.duration, 0);
  const joinCount = selectionCount === 0 ? 0 : (selectionCount > 0 && sliceGrid > 0 ? Math.ceil(selectionCount / sliceGrid) : 1);
  document.getElementById('fileNum').textContent = `${files.length}/${selectionCount}`;
  document.querySelector('.selection-count').textContent = ` ${selectionCount || '-'} `;
  document.getElementById('lengthHeaderLink').textContent = `Length (${secondsToMinutes(filesSelectedDuration)}/${secondsToMinutes(filesDuration)})`;
  if (secondsPerFile === 0) {
    document.querySelectorAll('.join-count').forEach(el => el.textContent = ` ${joinCount === 0 ? '-' : joinCount} `);
    try {
      document.querySelectorAll('tr').forEach(row => row.classList.remove('end-of-grid'));
      document.querySelectorAll('tr.checked').forEach(
          (row, i) => (i+1)%sliceGrid === 0 ? row.classList.add('end-of-grid') : row.classList.remove('end-of-grid'));

    } catch(e) {}
  } else { /*When using max length in seconds.*/
    const calcFiles = (items, count = 0) => {
      let progress = { duration: 0, processed: [], skipped: [], count };
      let _items = items;
      while (_items.length > 0) {
        progress = _items.reduce((a, f) => {
          if (a.duration + +f.meta.duration <= (secondsPerFile * pitchModifier) && a.processed.length < 24) {
            a.duration = a.duration + +f.meta.duration;
            a.processed.push(f);
          } else {
            a.skipped.push(f);
          }
          return a;
        }, progress);
        progress.count++;
        progress.duration = 0;
        progress.processed = [];
        _items = Array.from(progress.skipped);
        progress.skipped = [];
      }
      return progress.count;
    };

    let joinCountSec = filesSelected.length === 0 ? 0 : calcFiles(filesSelected);
    document.querySelector('.join-count-chain').textContent = ` ${joinCountSec === 0 ? '-' : joinCountSec} `;
    try {
      document.querySelectorAll('tr').forEach(row => row.classList.remove('end-of-grid'));
    } catch(e) {}
  }
  clearModifiers();
};

const buildRowMarkupFromFile = (f, type = 'main') => {
  return type === 'main' ?
      `
      <tr class="file-row ${f.meta.checked ? 'checked' : ''}" data-id="${f.meta.id}"
            onclick="digichain.handleRowClick(event, '${f.meta.id}')"
            onmousedown="digichain.handleRowClick(event, '${f.meta.id}')"  
            ondragstart="digichain.rowDragStart(event)" draggable="true">
        <td>
            <i class="gg-more-vertical"></i>
        </td>
        <td class="toggle-td">
            <button onclick="digichain.toggleCheck(event, '${f.meta.id}')" class="${f.meta.checked ? '' : 'button-outline'} check toggle-check">&nbsp;</button>
        </td>
        <td class="move-up-td">
            <button title="Move up in sample list." onclick="digichain.move(event, '${f.meta.id}', -1)" class="button-clear move-up"><i class="gg-chevron-up-r has-shift-mod-i"></i></button>
        </td>
        <td class="move-down-td">
            <button title="Move down in sample list." onclick="digichain.move(event, '${f.meta.id}', 1)" class="button-clear move-down"><i class="gg-chevron-down-r has-shift-mod-i"></i></button>
        </td>
        <td class="waveform-td">
            <canvas onclick="digichain.playFile(event, '${f.meta.id}')" class="waveform waveform-${f.meta.id} ${f.meta.playing ? 'playing' : ''}"></canvas>
        </td>
        <td class="file-path-td">
            <span class="file-path">${f.file.path}</span>
            <a title="Download processed wav file of sample." class="wav-link" onclick="digichain.downloadFile('${f.meta.id}', true)">${getNiceFileName(f.file.name)}</a>
            ${f.meta.dupeOf ? ' d' : ''}
            ${f.meta.editOf ? ' e' : ''}
            ${f.meta.isMerge ? ' m' : ''}
            ${f.meta.sliceNumber ? ' s' + f.meta.sliceNumber : ''}
            <a class="wav-link-hidden" target="_blank"></a>
        </td>
        <td class="duration-td">
            <span>${f.meta.duration} s</span>
        </td>
        <td class="channel-options-td">
            <div class="channel-options has-shift-mod" style="display: ${f.buffer.numberOfChannels > 1 && masterChannels === 1 ? 'block' : 'none'}">
            <a title="Left channel" onclick="digichain.changeChannel(event, '${f.meta.id}', 'L')" class="${f.meta.channel === 'L' ? 'selected' : ''} channel-option-L">L</a>
            <a title="Sum to mono" onclick="digichain.changeChannel(event, '${f.meta.id}', 'S')" class="${f.meta.channel === 'S' ? 'selected' : ''} channel-option-S">S</a>
            <a title="Right channel" onclick="digichain.changeChannel(event, '${f.meta.id}', 'R')" class="${f.meta.channel === 'R' ? 'selected' : ''} channel-option-R">R</a>
            <a title="Difference between Left and Right channels" onclick="digichain.changeChannel(event, '${f.meta.id}', 'D')" class="${f.meta.channel === 'D' ? 'selected' : ''} channel-option-D">D</a>
            </div>` +

      (lastUsedAudioConfig.includes('a') ?
            `<div class="channel-options channel-options-stereo channel-options-stereo-opf ${f.meta.opPanAb ? 'op-pan-ab-true' : ''}" title="${f.buffer.numberOfChannels === 1 ? 'Mono sample' : 'Stereo sample'}" style="display: ${masterChannels === 2 ? 'block' : 'none'}"
             ondblclick="digichain.changeOpParam(event, '${f.meta.id}', 'baltoggle')"
             >
                <input class="channel-balance" type="range" style="display: ${f.buffer.numberOfChannels === 2 ? 'inline-block' : 'none'}" min="0" max="32768" onchange="digichain.changeOpParam(event, '${f.meta.id}', 'bal')" value="${f.meta.opPan??16384}" />
                <i class="gg-shape-circle" style="display: ${f.buffer.numberOfChannels === 1 ? 'inline-block' : 'none'}"></i>
                <div style="display: ${f.buffer.numberOfChannels === 2 ? 'inline-block' : 'none'}">
                  <span class="op-la"></span>
                  <span class="op-rb"></span>
                </div>
            </div>` :
          `<div class="channel-options channel-options-stereo" title="${f.buffer.numberOfChannels === 1 ? 'Mono sample' : 'Stereo sample'}" style="display: ${masterChannels === 2 ? 'block' : 'none'}">
                <i class="gg-shape-circle"></i>
                <i class="gg-shape-circle stereo-circle" style="display: ${f.buffer.numberOfChannels === 2 ? 'inline-block' : 'none'}"></i>
            </div>`) +

      `</td>
        <td class="split-td">
            <button title="Slice sample." onclick="digichain.splitAction(event, '${f.meta.id}')" class="button-clear split gg-menu-grid-r ${metaFiles.getByFile(f)?.cssClass}"><i class="gg-menu-grid-r"></i></button>
        </td>
        <td class="duplicate-td">
            <button title="Duplicate sample." onclick="digichain.duplicate(event, '${f.meta.id}')" class="button-clear duplicate"><i class="gg-duplicate has-shift-mod-i"></i></button>
        </td>
        <td class="toggle-edit-td">
            <button title="Edit" onclick="digichain.showEditPanel(event, '${f.meta.id}')" class="button-clear toggle-edit"><i class="gg-pen"></i></button>
        </td>
        <td class="remove-td">
            <button title="Remove sample (double-click)." ondblclick="digichain.remove('${f.meta.id}')" class="button-clear remove"><i class="gg-trash"></i></button>
        </td>
      </tr>` :
      `
  <tr class="file-row" data-id="${f.meta.id}">
    <td class="file-path-td">
      <span class="file-path">${f.file.path}</span>
      <a title="Download processed wav file of sample." class="wav-link" onclick="digichain.downloadFile('${f.meta.id}', true)">${getNiceFileName(f.file.name)}</a>
      ${f.meta.dupeOf ? ' d' : ''}
      ${f.meta.editOf ? ' e' : ''}
      ${f.meta.isMerge ? ' m' : ''}
      ${f.meta.sliceNumber ? ' s' + f.meta.sliceNumber : ''}
      <a class="wav-link-hidden" target="_blank"></a>
    </td>
    <td class="duration-td">
      <span>${f.meta.duration} s</span>
    </td>
    <td class="channel-options-td"">
        <div class="channel-options" style="display: ${f.buffer.numberOfChannels > 1 ? 'block' : 'none'}">
        <a title="Left channel" onclick="digichain.changeChannel(event, '${f.meta.id}', 'L', false, '#mergeList')" class="${f.meta.channel === 'L' ? 'selected' : ''} channel-option-L">L</a>
        <a title="Sum to mono" onclick="digichain.changeChannel(event, '${f.meta.id}', 'S', false, '#mergeList')" class="${f.meta.channel === 'S' ? 'selected' : ''} channel-option-S">S</a>
        <a title="Right channel" onclick="digichain.changeChannel(event, '${f.meta.id}', 'R', false, '#mergeList')" class="${f.meta.channel === 'R' ? 'selected' : ''} channel-option-R">R</a>
        <a title="Difference between Left and Right channels" onclick="digichain.changeChannel(event, '${f.meta.id}', 'D', false, '#mergeList')" class="${f.meta.channel === 'D' ? 'selected' : ''} channel-option-D">D</a>
        </div>
        <div class="channel-options channel-options-stereo" title="Mono sample" style="display: ${f.buffer.numberOfChannels === 1 ? 'block' : 'none'}">
            <i class="gg-shape-circle"></i>
        </div>
    </td>
    <td class="pan-options-td">
        <div class="pan-options" style="display: block;">
        <a title="Hard Left" onclick="digichain.changePan(event, '${f.meta.id}', 'L')" class="${f.meta.pan === 'L' ? 'selected' : ''} pan-option-L">L</a>
        <a title="Centre" onclick="digichain.changePan(event, '${f.meta.id}', 'C')" class="${f.meta.pan === 'C' ? 'selected' : ''} pan-option-C">C</a>
        <a title="Hard Right" onclick="digichain.changePan(event, '${f.meta.id}', 'R')" class="${f.meta.pan === 'R' ? 'selected' : ''} pan-option-R">R</a>
        </div>
    </td>
  </tr>`;
};

const drawEmptyWaveforms = (_files) => {
  document.querySelectorAll('.waveform').forEach((el, i) => {
    if (!_files[i]) { return ; }
    if (_files[i].waveform) {
      el.replaceWith(_files[i].waveform);
      if (_files[i].playHead && !_files[i].waveform.nextElementSibling) {
        _files[i].waveform.parentElement.appendChild(_files[i].playHead);
      }
    } else {
      drawWaveform(_files[i], el, _files[i].meta.channel);
      _files[i].waveform = el;
    }
  });
  setCountValues();
};

const renderRow = (item, type) => {
  const rowData = item || getFileById(lastSelectedRow.dataset.id);
  const rowEl = item ? getRowElementById(item.meta.id) : lastSelectedRow;
  rowEl.innerHTML = buildRowMarkupFromFile(rowData, type);
  drawEmptyWaveforms(files);
  document.body.classList.remove('loading');
};

const renderList = () => {
  listEl.innerHTML = files.map( f => buildRowMarkupFromFile(f)).join('');
  if (files.length === 0) {
    listEl.innerHTML = '';
  }
  document.body.classList.remove('loading');
  drawEmptyWaveforms(files);
};
const bytesToInt = (bh, bm, bl) => {
  return ((bh & 0x7f) << 7 << 7) + ((bm & 0x7f) << 7) + (bl & 0x7f);
};

const parseOt = (fd, file, fullPath) => {
  const uuid = file.uuid || crypto.randomUUID();
  const getInt32 = values => {
    const arr = new Uint8Array(values);
    const view = new DataView(arr.buffer);
    return view.getInt32(0);
  };
  try {
    // Check header is correct.
    if (![0x46,0x4F,0x52,0x4D,0x00,0x00,0x00,0x00,0x44,0x50,0x53,0x31,0x53,0x4D,
      0x50,0x41].every(
          (b, i) => b === fd[i])
    ) {
      return { uuid, failed: true };
    }
    let slices = [];
    let sliceCount = getInt32 ([fd[826], fd[827], fd[828], fd[829]]);
    let t = 58;
    for (let s = 0; s < sliceCount; s++) {
      if (masterSR === 44100) {
        slices.push({
          startPoint: getInt32([fd[t], fd[t + 1], fd[t + 2], fd[t + 3]]),
          endPoint: getInt32([fd[t+4], fd[t+5], fd[t+6], fd[t+7]]),
          loopPoint: getInt32([fd[t+8], fd[t+9], fd[t+10], fd[t+11]])
        });
      } else {
        slices.push({
          startPoint: Math.round( (getInt32([fd[t], fd[t + 1], fd[t + 2], fd[t + 3]]) / 44100) * masterSR ),
          endPoint: Math.round( (getInt32([fd[t+4], fd[t+5], fd[t+6], fd[t+7]]) / 44100) * masterSR ),
          loopPoint: Math.round ((getInt32([fd[t+8], fd[t+9], fd[t+10], fd[t+11]]) / 44100) * masterSR )
        });
      }
      t = t + 12;
    }
    metaFiles.push({
      uuid,
      name: file.name,
      path: fullPath,
      cssClass: 'is-ot-file',
      sliceCount,
      slices
    });
    unsorted.push(uuid);
    return uuid;
  } catch(err) {
    return { uuid, failed: true };
  }
};
const parseAif = (arrayBuffer, fd, file, fullPath = '', pushToTop = false) => {
  const uuid = file.uuid || crypto.randomUUID();
  let result;
  try {
    let dv = new DataView(arrayBuffer);
    let chunks = {};
    let chunkKeys = ['FORM', 'COMM', 'APPL', 'SSND'];

    const getChunkData = (code, offset) => {
      switch (code) {
        case 'FORM':
          chunks.form = {
            offset,
            id: String.fromCharCode(dv.getUint8(offset),
                dv.getUint8(offset + 1),
                dv.getUint8(offset + 2), dv.getUint8(offset + 3)),
            fileSize: dv.getUint32(offset + 4),
            type: String.fromCharCode(dv.getUint8(offset + 8),
                dv.getUint8(offset + 9), dv.getUint8(offset + 10),
                dv.getUint8(offset + 11)),
          };
          break;
        case 'COMM':
          chunks.comm = {
            offset,
            id: String.fromCharCode(dv.getUint8(offset),
                dv.getUint8(offset + 1), dv.getUint8(offset + 2),
                dv.getUint8(offset + 3)),
            size: dv.getUint32(offset + 4),
            channels: dv.getUint16(offset + 8),
            frames: dv.getUint32(offset + 10),
            bitDepth: dv.getUint16(offset + 14),
            //sampleRate: dv.getFloat32(offset + 16, true)
          };
          break;
        case 'APPL'://'op-1':
          const utf8Decoder = new TextDecoder('utf-8');
          //let maxSize = chunks.form.type === 'AIFC' ? 44100 * 20 : 44100 * 12;
          let scale = chunks.form.type === 'AIFC' && chunks.comm.numberOfChannels === 2 ? 2434 : 4058;
          chunks.json = {
            id: String.fromCharCode(dv.getUint8(offset),
                dv.getUint8(offset + 1), dv.getUint8(offset + 2),
                dv.getUint8(offset + 3)),
            size: dv.getUint32(offset + 4),
            //bytesInLength: maxSize * 2,
            scale,
          };
          let jsonString = utf8Decoder.decode(
              arrayBuffer.slice(offset + 12, chunks.json.size + offset + 8));
          chunks.json.data = JSON.parse(
              jsonString.replace(/\]\}(.|\n)+/gi, ']}').trimEnd());
          if (chunks.json.data?.original_folder === 'digichain') {
            chunks.json.scale = 2434;
          }
              //jsonString.replace(/\]\}.*/gi, ']}').trimEnd());
          break;
        case 'SSND':
          chunks.buffer = arrayBuffer.slice(offset + 4);
          chunks.bufferDv = new DataView(chunks.buffer);
      }
    };

    for (let i = 0; i < dv.byteLength - 4; i++) {
      const code = String.fromCharCode(dv.getUint8(i), dv.getUint8(i+1), dv.getUint8(i+2), dv.getUint8(i+3))
      if (chunkKeys.includes(code)) {
        getChunkData(code, i);
        chunkKeys = chunkKeys.filter(k => k !== code);
      }
    }
    if (!chunks.json) {
      // Not an OP-1 aif, which is the only type of aif file supported.
      return { uuid, failed: true };
    }

    const offset = 4; // The offset of the first byte of audio data
    const bytesPerSample = chunks.comm.bitDepth / 8;
    const channels = [];
    for (let i = 0; i < chunks.comm.channels; i++) {
      channels.push(new Float32Array(chunks.comm.frames));
    }

    for (let i = 0; i < chunks.comm.channels; i++) {
      let channel = channels[i];
      for (let j = 0; j < chunks.comm.frames; j++) {
        let index = offset;
        index += (j * chunks.comm.channels + i) * bytesPerSample;
        // Sample
        let value = chunks.bufferDv.getInt16(index, chunks.form.type === 'AIFC');
        // Scale range from 0 to 2**bitDepth -> -2**(bitDepth-1) to
        // 2**(bitDepth-1)
        let range = 1 << chunks.comm.bitDepth - 1;
        if (value >= range) {
          value |= ~(range - 1);
        }
        // Scale range to -1 to 1
        channel[j] = value / range;
        if (j === 0) {
          channel[j] = 0;
        }
      }
    }
    
    const resample = new Resampler(44100, masterSR, 1,
       channels[0]);
    let resampleR;
    resample.resampler(resample.inputBuffer.length);

    if (chunks.comm.channels === 2) {
      resampleR = new Resampler(44100, masterSR, 1,
          channels[1]);
      resampleR.resampler(resampleR.inputBuffer.length);
    }

    const audioArrayBuffer = audioCtx.createBuffer(
        chunks.comm.channels,
        resample.outputBuffer.length,
        masterSR
    );
    if (chunks.comm.channels === 2) {
      for (let i = 0; i < resample.outputBuffer.length; i++) {
        audioArrayBuffer.getChannelData(0)[i] = resample.outputBuffer[i];
        audioArrayBuffer.getChannelData(1)[i] = resampleR.outputBuffer[i];
      }
    } else {
      for (let i = 0; i < resample.outputBuffer.length; i++) {
        audioArrayBuffer.getChannelData(0)[i] = resample.outputBuffer[i];
      }
    }
    const getRelPosition = (v, i) => {
      //const cVal = Math.min(Math.max(v - 1, 0), chunks.json.maxSize);
      //return Math.round((chunks.comm.frames * 44100) / chunks.json.bytesInLength * cVal * 2);
      //return v / (chunks.json.bytesInLength / chunks.comm.frames);
      return (v / chunks.json.scale) - (i*13);
      //return rightRotate(v, i);
    };

    let INT_BITS = 16;
    /*Function to left rotate n by d bits*/
    function leftRotate(n, d) {
      /* In n<<d, last d bits are 0. To
       put first 3 bits of n at
      last, do bitwise or of n<<d
      with n >>(INT_BITS - d) */
      return (n << d) | (n >> (INT_BITS - d));
    }

    /*Function to right rotate n by d bits*/
    function rightRotate(n, d) {
      /* In n>>d, first d bits are 0.
      To put last 3 bits of at
      first, do bitwise or of n>>d
      with n <<(INT_BITS - d) */
      return (n >> d) | (n << (INT_BITS - d));
    }


    /*Update the slice points to masterSR*/
    if (chunks.json.data.start) {
      chunks.json.data.start = chunks.json.data.start.map((s, i) => Math.floor((getRelPosition(s, i) / 44100) * masterSR));
    }
    if (chunks.json.data.end) {
      chunks.json.data.end = chunks.json.data.end.map((s, i) => Math.floor((getRelPosition(s, i) / 44100) * masterSR));
    }

    files[pushToTop ? 'unshift' : 'push']({
      file: {
        lastModified: file.lastModified,
        name: file.name,
        path: fullPath.replace(file.name, ''),
        size: file.size,
        type: file.type
      },
      buffer: audioArrayBuffer, meta: {
        length: audioArrayBuffer.length,
        duration: Number(audioArrayBuffer.length / masterSR).toFixed(3),
        startFrame: 0, endFrame: audioArrayBuffer.length,
        op1Json: chunks.json.data,
        channel: audioArrayBuffer.numberOfChannels > 1 ? 'L' : '',
        checked: true, id: uuid,
        slices: false
      }
    });
    unsorted.push(uuid);
    return uuid;
  } catch(err) {
    return { uuid, failed: true };
  }
};

const parseSds = (fd, file, fullPath = '', pushToTop = false) => {
  const uuid = file.uuid || crypto.randomUUID();
  try {
    // Check header is correct.
    if (!(fd[0] === 240 && fd[1] === 126 && fd[3] === 1 && fd[20] === 247)) {
      return { uuid, failed: true };
    }
    const bitRate = fd[6];
    const sampleRate = Math.ceil(10e7 / bytesToInt(fd[9], fd[8], fd[7])) * 10;
    const length = bytesToInt(fd[12], fd[11], fd[10]);
    let loopStart = bytesToInt(fd[15], fd[14], fd[13]);
    let loopEnd = bytesToInt(fd[18], fd[17], fd[16]) + 1;
    const loopType = fd[19];

    if (loopType === 0x7f) { loopStart = loopEnd = length; }
    if (sampleRate < 4000 || sampleRate > 96000) { return false; }
    if (bitRate !== 16) { return false; }

    let idx = fd.findIndex(
        (x, i) => (x === 0xf0 && fd[i + 1] === 0x7e && fd[i + 3] === 0x02 &&
            fd[i + 126] === 0xf7));

    let lengthRead = 0;
    let data = [];

    while (lengthRead < length) {
      for (let t = (idx + 5); t < (idx + 125) && lengthRead < length; t += 3) {
        data[lengthRead++] = (((fd[t] << 9) | (fd[t + 1] << 2) |
            (fd[t + 2] >> 5)) - 0x8000);
      }
      idx = idx + 127;
    }

    const resample = new Resampler(sampleRate, masterSR, 1,
        data.filter(x => x !== undefined));
    resample.resampler(resample.inputBuffer.length);
    const audioArrayBuffer = audioCtx.createBuffer(
        1,
        resample.outputBuffer.length -
        ((resample.outputBuffer.length / 120) * 5),
        masterSR
    );
    resample.outputBuffer.filter(x => x !== undefined).
        forEach((y, i) => audioArrayBuffer.getChannelData(0)[i] = y / 32767);

    files[pushToTop ? 'unshift' : 'push']({
      file: {
        lastModified: file.lastModified,
        name: file.name,
        path: fullPath.replace(file.name, ''),
        size: file.size,
        type: file.type
      },
      buffer: audioArrayBuffer, meta: {
        length: resample.outputBuffer.length, loopStart, loopEnd, loopType,
        duration: Number(resample.outputBuffer.length / masterSR).toFixed(3),
        startFrame: 0, endFrame: resample.outputBuffer.length,
        checked: true, id: uuid,
        slices: false
      }
    });
    unsorted.push(uuid);
    return uuid;
  } catch(err) {
    return { uuid, failed: true };
  }
};

const parseWav = (audioArrayBuffer, arrayBuffer, file, fullPath = '', pushToTop = false, checked = true) => {
  const uuid = file.uuid || crypto.randomUUID();
  let slices = false;
  try {
    let dv = new DataView(arrayBuffer);
    for (let i = 0; i < dv.byteLength - 4; i++) {
      const code = String.fromCharCode(dv.getUint8(i), dv.getUint8(i + 1),
          dv.getUint8(i + 2), dv.getUint8(i + 3));
      if (i > dv.byteLength || code === 'PAD ') {
        break;
      }
      if (code === 'data') {
        const size = dv.getUint32(i + 4, true);
        if (size && size < dv.byteLength) {
          i = size - 8;
        }
      }
      if (code === 'DCSD') {
        const size = dv.getUint32(i + 4);
        const utf8Decoder = new TextDecoder('utf-8');
        let jsonString = utf8Decoder.decode(
            arrayBuffer.slice(i + 8, i + 8 + size));
        const json = JSON.parse(jsonString.trimEnd());
        if (json.sr !== masterSR) {
          slices = json.dcs.map(slice => ({
            s: Math.round((slice.s / json.sr) * masterSR),
            e: Math.round((slice.e / json.sr) * masterSR),
            n: slice.n
          }));
        } else {
          slices = json.dcs;
        }
      }
    }
    } catch(e) {
    slices = false;
  }
  try {
    /*duration, length, numberOfChannels, sampleRate*/
    files[pushToTop ? 'unshift' : 'push']({
      file: {
        lastModified: file.lastModified,
        name: file.name,
        path: fullPath.replace(file.name, ''),
        size: file.size,
        type: file.type
      },
      buffer: audioArrayBuffer, meta: {
        length: audioArrayBuffer.length,
        duration: Number(audioArrayBuffer.length / masterSR).toFixed(3),
        startFrame: 0, endFrame: audioArrayBuffer.length,
        checked: checked, id: uuid,
        channel: audioArrayBuffer.numberOfChannels > 1 ? 'L' : '',
        slices: file.slices??slices
      }
    });
    unsorted.push(uuid);
    return uuid;
  } catch (err) {
    return { uuid, failed: true };
  }
};

const renderListWhenReady = (count, fileCount) => {
  count = count.filter(c => c !== false);
  if (count.every(c => unsorted.includes(c))) {
    renderList();
  } else {
    setTimeout(() => renderListWhenReady(count), 1000);
  }
}

const setLoadingProgress = (count, total) => {
  const el = document.getElementById('loadingText');
  let progress = (count/total) * 100;
  el.style.backgroundImage = `linear-gradient(90deg, #cf8600 ${progress}%, #606c76 ${progress + 1}%, #606c76 100%)`;
};

const consumeFileInput = (inputFiles) => {
  document.getElementById('loadingText').textContent = 'Loading samples';
  document.body.classList.add('loading');
  const _files = [...inputFiles].filter(
      f => ['syx', 'wav', 'flac', 'aif'].includes(f?.name?.split('.')?.reverse()[0].toLowerCase())
  );
  const _mFiles = [...inputFiles].filter(
      f => ['ot'].includes(f?.name?.split('.')?.reverse()[0].toLowerCase())
  );

  _mFiles.forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      file.uuid = crypto.randomUUID();
      file.fullPath = file.fullPath || '';
      if (file.name.toLowerCase().endsWith('.ot')) {
        // binary data
        const buffer = e.target.result;
        const bufferByteLength = buffer.byteLength;
        const bufferUint8Array = new Uint8Array(buffer, 0, bufferByteLength);
        let result = parseOt(bufferUint8Array, file, file.fullPath);
      }
    };
    reader.readAsArrayBuffer(file);
  });
  if (_files.length === 0) {
    return renderList();
  }

  const checkCount = (idx) => {
    //count = count.filter(c => c !== false);
    //if (idx === _files.length - 1) {
      if (count.every(c => unsorted.includes(c))) {
        setTimeout(() => renderListWhenReady(count), 1000);
      } else {
       // setTimeout(() => renderListWhenReady(count), 1000);
      }
    //}
  };
  let count = [];

  _files.forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      file.uuid = crypto.randomUUID();
      file.fullPath = file.fullPath || '';
      const buffer = e.target.result;
      if (file.name.toLowerCase().endsWith('.syx') || file.name.toLowerCase().endsWith('.aif')) {
        // binary data
        const bufferByteLength = buffer.byteLength;
        const bufferUint8Array = new Uint8Array(buffer, 0, bufferByteLength);
        count.push(file.uuid);
        let result = file.name.toLowerCase().endsWith('.aif') ?
            parseAif(buffer, bufferUint8Array, file, file.fullPath):
            parseSds(bufferUint8Array, file, file.fullPath);
        if (result.failed) {
          count.splice(count.findIndex(c => c === result.uuid ),1);
        }
        setLoadingProgress(idx + 1, _files.length);
        checkCount(idx, _files.length);
      }

      if ((file.name.toLowerCase().endsWith('.wav') || file.type === 'audio/wav') || file.name.toLowerCase().endsWith('.flac')) {
        count.push(file.uuid);
        const fb = buffer.slice(0);
        audioCtx.decodeAudioData(buffer, data => {
          let result = parseWav(data, fb, file, file.fullPath);
          if (result.failed) {
            count.splice(count.findIndex(c => c === result.uuid ),1);
          }
          setLoadingProgress(idx + 1, _files.length);
          checkCount(idx, _files.length);
        });
      }
    };
    reader.readAsArrayBuffer(file);
  });

};

uploadInput.addEventListener(
    'change',
    () => consumeFileInput(uploadInput.files),
    false
);

document.body.addEventListener(
    'dragover',
    (event) => {
      event.preventDefault();
    },
    false
);

document.body.addEventListener(
    'drop',
    (event) => {
      event.preventDefault();
      if (event?.dataTransfer?.items?.length && event?.dataTransfer?.items[0].kind === 'string') {
        try {
          event?.dataTransfer?.items[0].getAsString(async link => {
            let linkedFile = await fetch(link);
            if (!linkedFile.url.includes('.wav')) { return ; } // probably not a wav file
            let buffer = await linkedFile.arrayBuffer();
            const fb = buffer.slice(0);
            await audioCtx.decodeAudioData(buffer, data => parseWav(data, fb, {
              lastModified: new Date().getTime(), name: linkedFile.url.split('/').reverse()[0],
              size: ((masterBitDepth * masterSR * (buffer.length / masterSR)) / 8) * buffer.numberOfChannels /1024,
              type: 'audio/wav'
            }, '', true));
            renderList();
          });
          return;
        } catch (e) {}
      }
      if (event?.dataTransfer?.items?.length) {
        let toConsume = [];
        let total = event.dataTransfer.items.length;
        toConsume.count = 0;
        const addItem = item => {
          if (item.isFile) {
            item.file(
                (file) => {
                  file.fullPath = item.fullPath.replace('/', '');
                  toConsume.push(file);
                }
            );
            toConsume.count++;
            total--;
          } else if (item.isDirectory) {
            const dirReader = item.createReader();
            dirReader.readEntries(entries => {
              total += entries.length;
              for (const entry of entries) {
                addItem(entry);
              }
              total--;
            });
          }
        }
        for (const entry of event.dataTransfer.items) {
          const itemAsEntry = entry.getAtEntry ? entry.getAtEntry() : entry.webkitGetAsEntry();
          if (itemAsEntry) {
            addItem(itemAsEntry);
          }
        }
        let doneInterval = setInterval(() => {
          if (total <= 0 && toConsume.count === toConsume.length) {
            clearInterval(doneInterval);
            consumeFileInput(toConsume);
          }
        }, 500);
      } else {
        let target = event.target;
        if (document.getElementById('opExportPanel').classList.contains('show')) {
          // Block row re-ordering while op export side panel is open.
          return ;
        }
        while (!target.classList.contains('file-row')) {
          target = target.parentElement || document.body;
          target = target.nodeName === 'THEAD' ? document.querySelector('tr.file-row') : target;
          target = target === document.body ? document.querySelector('tr.file-row:last-of-type') : target;
        }
        if (target) {
          let selectedRowId = getFileIndexById(lastSelectedRow.dataset.id);
          let targetRowId = getFileIndexById(target.dataset.id);
          let item = files.splice(selectedRowId, 1)[0];
          files.splice(targetRowId, 0, item);
          targetRowId === 0 ? target.before(lastSelectedRow) : target.after(lastSelectedRow);
        }
      }
    },
    false
);

document.body.addEventListener('keyup', (event) => {
  clearModifiers();
});

document.body.addEventListener('keydown', (event) => {
  const numberKeys = ['Digit1', 'Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8', 'Digit9', 'Digit0'];
  const eventCodes = ['ArrowDown', 'ArrowUp', 'Escape', 'Enter', 'KeyD', 'KeyG', 'KeyH', 'KeyI', 'KeyL', 'KeyP', 'KeyR', 'KeyS', 'KeyX',
      ...numberKeys
  ];
  if (keyboardShortcutsDisabled) { return ; }
  if (event.shiftKey) { document.body.classList.add('shiftKey-down'); }
  if (event.ctrlKey) { document.body.classList.add('ctrlKey-down'); }
  if (event.code === 'Escape') {
    if (files.length && !(event.shiftKey || modifierKeys.shiftKey)) {
      files.filter(f => f.meta.playing && f.meta.id).forEach(f => stopPlayFile(false, f.meta.id));
    }
    return closePopUps();
  }
  if (arePopUpsOpen()) {
    // Don't listen for keyboard commands when popups are open.
    return ;
  }

  if (numberKeys.includes(event.code)) {
    let id = +event.code.charAt(event.code.length - 1);
    const selected = files.filter(f => f.meta.checked);
    id = id === 0 ? 9 : (id - 1);
    if (selected[id]) {
      event.altKey ?
          stopPlayFile(false, selected[id].meta.id) :
          playFile(false, selected[id].meta.id, (event.shiftKey || modifierKeys.shiftKey));
    }
  }

  if (event.code === 'ArrowDown' && (!lastSelectedRow || !lastSelectedRow.isConnected)) {
    lastSelectedRow = document.querySelector('#fileList tr');
    return;
  }
  if (files.length &&  (event.code === 'KeyI')) {
    return invertFileSelection();
  }
  if (event.code === 'KeyH' && (event.shiftKey || modifierKeys.shiftKey)) {
    toggleOptionsPanel();
  }
  if (event.code === 'KeyG' && (event.shiftKey || modifierKeys.shiftKey)) {
    document.body.classList.contains('grid-view') ? document.body.classList.remove('grid-view') : document.body.classList.add('grid-view');
  }
  if (eventCodes.includes(event.code) && lastSelectedRow && lastSelectedRow?.isConnected) {
    if (event.code === 'ArrowDown' && lastSelectedRow.nextElementSibling) {
      if (!(event.shiftKey || modifierKeys.shiftKey)) { return handleRowClick(event, lastSelectedRow.nextElementSibling.dataset.id); }
      let idx = getFileIndexById(lastSelectedRow.dataset.id);
      let item = files.splice(idx, 1)[0];
      files.splice(idx + 1, 0, item);
      lastSelectedRow.nextElementSibling.after(lastSelectedRow);
      lastSelectedRow.scrollIntoViewIfNeeded();
      setCountValues();
    } else if (event.code === 'ArrowUp' && lastSelectedRow.previousElementSibling) {
      if (!(event.shiftKey || modifierKeys.shiftKey)) { return handleRowClick(event, lastSelectedRow.previousElementSibling.dataset.id); }
      let idx = getFileIndexById(lastSelectedRow.dataset.id);
      let item = files.splice(idx, 1)[0];
      files.splice(idx - 1, 0, item);
      lastSelectedRow.previousElementSibling.before(lastSelectedRow);
      lastSelectedRow.scrollIntoViewIfNeeded();
      setCountValues();
    } else if (event.code === 'Enter') {
      toggleCheck(event, lastSelectedRow.dataset.id);
    } else if (event.code === 'KeyP') {
      event.altKey ? stopPlayFile(false, lastSelectedRow.dataset.id) : playFile(event, lastSelectedRow.dataset.id);
    } else if (masterChannels === 1 && (event.code === 'KeyL' || event.code === 'KeyR' || event.code === 'KeyS' || event.code === 'KeyD')) {
      const item = getFileById(lastSelectedRow.dataset.id);
      if (item.meta.channel) {
        changeChannel(event, lastSelectedRow.dataset.id, event.code.replace('Key', ''));
      }
    }
  }
});

/*Actions based on restored local storage states*/
pitchExports(pitchModifier, true);
document.querySelector('.touch-buttons').classList[
    showTouchModifierKeys ? 'remove' : 'add'
    ]('hidden');
if (restoreLastUsedAudioConfig) {
  changeAudioConfig({
    target: document.getElementById('audioConfigOptions')
  }, lastUsedAudioConfig);
} else {
  setEditorConf({
    audioCtx,
    masterSR,
    masterChannels,
    masterBitDepth
  });
}

/*Expose properties/methods used in html events to the global scope.*/
window.digichain = {
  sliceOptions,
  changeAudioConfig,
  removeSelected,
  trimRightSelected,
  normalizeSelected,
  reverseSelected,
  showMergePanel,
  sort,
  renderList,
  renderRow,
  joinAll: joinAllUICall,
  performMergeUiCall,
  selectSliceAmount,
  showInfo,
  toggleCheck,
  move,
  playFile,
  stopPlayFile,
  downloadFile,
  downloadAll,
  changeChannel,
  changePan,
  duplicate,
  remove,
  handleRowClick,
  rowDragStart,
  splitAction,
  splitEvenly,
  splitFromFile,
  splitSizeAction,
  splitFromTrack,
  toggleModifier,
  toggleOptionsPanel,
  showExportSettingsPanel,
  showEditPanel,
  pitchExports,
  toggleSetting,
  toggleSecondsPerFile,
  changeOpParam,
  editor
};
