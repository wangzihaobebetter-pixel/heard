/**
 * Every string on the four screens, verbatim from DESIGN §4 (both languages).
 * WP0 owns this file; packages read keys, they do not add copy of their own —
 * new copy comes back through the design of record.
 */
import { registerStrings } from './index';

/* ------------------------------------------------------------ §4.1 Library */

registerStrings('library', {
  en: {
    'title': 'Library',
    'lede': 'Try pressing any timecode.',
    'emptyTitle': 'Nothing here yet.',
    'emptyBody': 'Bring a recording, or bring the sample back.',
    'cardStatus': '{notes} notes · {heard} heard',
    'cardListening': 'Heard {done} of {total} min',
    'readFailed': `I couldn't open your saved interviews on this device. Nothing was deleted.`,
  },
  'zh-CN': {
    'title': '资料库',
    'lede': '试着点任意一个时间码。',
    'emptyTitle': '这里还没有东西。',
    'emptyBody': '带一段录音进来，或者把示例请回来。',
    'cardStatus': '{notes} 条笔记 · 已听证 {heard} 条',
    'cardListening': '已听 {done} / {total} 分钟',
    'readFailed': '打不开这台设备上保存的访谈。什么都没有被删除。',
  },
});

/* ---------------------------------------------------------- §4.2 Interview */

registerStrings('interview', {
  en: {
    'title': 'Interview',
    'tabNotes': 'Notes',
    'tabTranscript': 'Transcript',
    'tabNotesCount': 'Notes {n}',
    'sectionPoints': 'Points',
    'sectionQuotable': 'Quotable',
    'sectionYours': 'Yours',
    'heard': 'heard',
    'contextStrip': '{duration} · heard {date} · {lang}',
    'selectHint': 'Select any words in the transcript to save your own quote.',
    'firstRun': 'This is a real recording. Press any timecode.',
    'unpinned': `Couldn't pin this to the tape — nearest place shown.`,
    'notHeardTitle': `This one hasn't been heard yet.`,
    'audioMissing': `The recording isn't on this device.`,
    'wrongFile': `That doesn't seem to be the same recording — it's {found}, this one was {expected}.`,
    'gapTitle': `Couldn't hear minutes {from}–{to}.`,
    'listening': 'Listening… {done} of {total} min',
    'notesPending': 'Notes will appear after the recording has been heard.',
    'notesRetryTitle': 'The transcript is ready. The notes are not.',
    'notesRetryBody': 'Your recording is safe. Try the notes model again without retranscribing it.',
    'notesRetryAction': 'Try notes again',
    'readingBack': 'Reading it back…',
    'heardOfMin': 'heard {done} of {total} min',
    'nudge': 'Nudge',
    'speed': 'Speed',
    'deleteConfirm': 'Delete this interview and its notes? The recording goes too.',
  },
  'zh-CN': {
    'title': '访谈',
    'tabNotes': '笔记',
    'tabTranscript': '原文',
    'tabNotesCount': '笔记 {n}',
    'sectionPoints': '要点',
    'sectionQuotable': '可引用',
    'sectionYours': '你的',
    'heard': '已听证',
    'contextStrip': '{duration} · {date} 听过 · {lang}',
    'selectHint': '在原文里选中任意几句，存成你自己的引文。',
    'firstRun': '这是一段真实的录音。点任意一个时间码。',
    'unpinned': '没能钉到录音上——这是最接近的位置。',
    'notHeardTitle': '这一段还没有被听过。',
    'audioMissing': '录音不在这台设备上。',
    'wrongFile': '好像不是同一段录音——它是 {found}，这一段是 {expected}。',
    'gapTitle': '{from}–{to} 分钟没有听清。',
    'listening': '正在听… {done} / {total} 分钟',
    'notesPending': '听完录音后，笔记会出现在这里。',
    'notesRetryTitle': '原文已经好了，笔记还没有。',
    'notesRetryBody': '录音和原文都很安全。你可以只重试笔记，不必重新转写。',
    'notesRetryAction': '重新生成笔记',
    'readingBack': '正在读一遍…',
    'heardOfMin': '已听 {done} / {total} 分钟',
    'nudge': '微调',
    'speed': '速度',
    'deleteConfirm': '删除这段访谈和它的笔记？录音也会一起删掉。',
  },
});

/* -------------------------------------------------------------- §4.3 Bring */

registerStrings('bring', {
  en: {
    'title': 'Bring a recording',
    'eyebrow': 'From recording to receipts',
    'intro': 'A class, an interview, a conversation worth keeping — turn it into notes you can check.',
    'promiseKicker': 'What comes back',
    'promiseTitle': 'Useful notes, still attached to the voice.',
    'promiseBody': 'Heard keeps the path back to what was actually said, so a summary never has to be taken on faith.',
    'transcriptReturn': 'A transcript that follows the sound',
    'notesReturn': 'Notes with a pressable source',
    'proofPreview': 'press to hear the source',
    'boundary': 'No Heard account or upload server. Your browser talks directly to the providers you connect.',
    'choose': 'Choose a recording',
    'dropHint': 'or drop it here',
    'fieldTitle': 'Title',
    'fieldLanguage': 'Language',
    'keepAudio': 'Keep the original after transcription',
    'keepAudioWhy': 'Keep it to play every receipt later. If off, the imported copy is used only for this transcription session.',
    'keyLabel': 'Transcription key',
    'keyWhy': 'Stored only in this browser. Sent only to the provider you pick.',
    'estimate': 'About 3–5 minutes for a 92-minute recording. You can start reading as it goes.',
    'tooBigMobile': 'This file is {size}. On this phone I can hear recordings up to 25 MB; on a laptop, up to about 3 hours.',
    'tooLong': `That's longer than 3 hours. Split it first — Heard is built for interviews.`,
    'keyRefused': 'The key was refused by {provider}.',
    'offline': `You're offline. Existing interviews still play; new ones need a connection to be heard.`,
    'unsupported': `I can't read that kind of file. Try mp3, m4a, wav or mp4.`,
  },
  'zh-CN': {
    'title': '带一段录音进来',
    'eyebrow': '从录音，到有凭据的笔记',
    'intro': '一堂课、一次访谈、一段值得留下的对话——把它变成随时可以核对的笔记。',
    'promiseKicker': '你会得到什么',
    'promiseTitle': '有用的笔记，始终连着说话的声音。',
    'promiseBody': '听证保留回到原话的路径，所以任何摘要都不必只凭相信。',
    'transcriptReturn': '随声音同步的原文',
    'notesReturn': '按一下就能听回来源的笔记',
    'proofPreview': '按下，听回原声',
    'boundary': '听证没有账号或上传服务器。浏览器只会直接连接你选择的服务。',
    'choose': '选择一段录音',
    'dropHint': '或者拖到这里',
    'fieldTitle': '标题',
    'fieldLanguage': '语言',
    'keepAudio': '转写后保留原始录音',
    'keepAudioWhy': '保留后可以随时回听每条凭据；关闭时，导入副本只在本次转写会话中临时使用。',
    'keyLabel': '转写密钥',
    'keyWhy': '只存在这个浏览器里，只发给你选的服务方。',
    'estimate': '92 分钟的录音大约要 3–5 分钟。可以边听边读。',
    'tooBigMobile': '这个文件 {size}。在手机上我最多能听 25 MB 的录音；在电脑上大约能到 3 小时。',
    'tooLong': '超过 3 小时了。先分一下——听证是为访谈做的。',
    'keyRefused': '{provider} 拒绝了这个密钥。',
    'offline': '现在离线。已有的访谈可以照常播放；新的需要联网才能听。',
    'unsupported': '这种文件我读不了。试试 mp3、m4a、wav 或 mp4。',
  },
});

/* ----------------------------------------------------------- §4.4 Settings */

registerStrings('settings', {
  en: {
    'title': 'Settings',
    'eyebrow': 'Connections and this device',
    'intro': 'Choose what does the listening, what writes the notes, and what this browser keeps.',
    'connections': 'Connections',
    'onDevice': 'On this device',
    'privacyTitle': 'Privacy boundary',
    'privacyHeading': 'A direct line, not a hidden cloud.',
    'privacyWhy': 'Keys are used only for those direct provider calls. Heard has no account to sync or sell.',
    'transcription': 'Transcription',
    'notes': 'Notes',
    'notesWhy': 'Notes are written by a text model reading the transcript. It never hears the audio.',
    'provider': 'Provider',
    'baseUrl': 'Base URL',
    'key': 'Key',
    'model': 'Model',
    'connectedTo': 'Connected to {provider}',
    'notConnected': 'Not connected',
    'language': 'Language',
    'theme': 'Theme',
    'themeSystem': 'System',
    'themePaper': 'Paper',
    'themeInk': 'Ink',
    'storage': 'Storage',
    'keepImportedAudio': 'Keep imported originals after transcription',
    'storageLine': 'This device holds {count} interviews · {size}',
    'storageDegraded': `This browser wouldn't give me its database, so everything is in smaller storage instead. Recordings may not survive.`,
    'about': 'About',
    'aboutLine': 'Heard has no account or server. Audio goes directly to the transcription provider you connect. Transcript text goes directly to the notes provider you connect. Recordings, transcripts, notes and keys are stored in this browser until you remove them.',
    'github': 'Source on GitHub',
    'testOk': 'OK, {seconds} s',
    'testFail': '{status} · {message}',
    'testRunning': 'Testing…',
  },
  'zh-CN': {
    'title': '设置',
    'eyebrow': '连接与这台设备',
    'intro': '选择谁来听、谁来写笔记，以及这个浏览器要保留什么。',
    'connections': '服务连接',
    'onDevice': '这台设备',
    'privacyTitle': '隐私边界',
    'privacyHeading': '直接连接，不藏在一朵看不见的云里。',
    'privacyWhy': '密钥只用于这些直接的服务请求。听证没有可同步或出售的账号。',
    'transcription': '转写',
    'notes': '笔记',
    'notesWhy': '笔记由文本模型读原文写成，它听不到音频。',
    'provider': '服务方',
    'baseUrl': '接口地址',
    'key': '密钥',
    'model': '模型',
    'connectedTo': '已连接 {provider}',
    'notConnected': '尚未连接',
    'language': '语言',
    'theme': '主题',
    'themeSystem': '跟随系统',
    'themePaper': '纸',
    'themeInk': '墨',
    'storage': '存储',
    'keepImportedAudio': '转写后保留导入的原始录音',
    'storageLine': '这台设备上有 {count} 段访谈 · {size}',
    'storageDegraded': '这个浏览器不让我用数据库，所以只能用更小的存储。录音可能保不住。',
    'about': '关于',
    'aboutLine': '听证没有账号或自有服务器。音频会直接发给你接入的转写服务；原文会直接发给你接入的笔记服务。录音、原文、笔记和密钥保存在这个浏览器里，直到你移除它们。',
    'github': 'GitHub 源码',
    'testOk': '正常，{seconds} 秒',
    'testFail': '{status} · {message}',
    'testRunning': '正在测试…',
  },
});

/* ------------------------------------------------------------- §4.5 Export */

registerStrings('exportSheet', {
  en: {
    'title': 'Quote sheet',
    'subtitle': 'Recorded {date} · {duration} · {filename} · transcribed with Heard',
    'notChecked': '(not yet checked)',
    'empty': 'Nothing to export yet — the notes come once the recording has been heard.',
  },
  'zh-CN': {
    'title': '引文清单',
    'subtitle': '录制于 {date} · {duration} · {filename} · 由听证转写',
    'notChecked': '（尚未核听）',
    'empty': '还没有可以导出的东西——整段听完之后笔记才会出现。',
  },
});

/* ------------------------------------------------------------- §4.1 Record (v3 B2) */

registerStrings('record', {
  en: {
    'title': 'Record',
    'start': 'Start recording',
    'privacy': 'Your audio never leaves this device unless you connect a provider.',
    'recording': 'Recording',
    'paused': 'Paused',
    'pause': 'Pause',
    'resume': 'Resume',
    'mark': 'Mark',
    'done': 'Done',
    'discard': 'Discard',
    'discardAsk': 'Throw this recording away?',
    'discardYes': 'Throw it away',
    'discardNo': 'Keep recording',
    'silenceWarn': 'Nothing has been heard for 20 seconds — check the microphone.',
    'denied': 'The microphone was refused. Allow it in the browser and try again.',
    'unavailable': 'This browser can\'t record here. Bringing a file still works.',
    'notePlaceholder': 'Type a note — it pins to this moment',
    'noteAdd': 'Add',
    'noteCount': 'Pinned notes: {n}',
  },
  'zh-CN': {
    'title': '录音',
    'start': '开始录音',
    'privacy': '你的音频不会离开这台设备，除非你接入一个转写服务。',
    'recording': '正在录音',
    'paused': '已暂停',
    'pause': '暂停',
    'resume': '继续',
    'mark': '标记',
    'done': '完成',
    'discard': '丢弃',
    'discardAsk': '把这段录音扔掉？',
    'discardYes': '扔掉',
    'discardNo': '继续录',
    'silenceWarn': '已经 20 秒没有听到声音——检查一下麦克风。',
    'denied': '麦克风被拒绝了。在浏览器里允许之后再试。',
    'unavailable': '这个浏览器录不了音。带一个文件进来仍然可以。',
    'notePlaceholder': '打一条笔记——它会钉在此刻',
    'noteAdd': '添加',
    'noteCount': '已钉下 {n} 条笔记',
  },
});

/* ----------------------------------------- v3 B2: waiting state + recovery */

registerStrings('interview', {
  en: {
    'waiting': 'recorded, not yet transcribed',
    'waitingBody': 'The tape is safe on this device. Connect a transcription provider and it will be read.',
    'waitingCta': 'Connect a provider',
  },
  'zh-CN': {
    'waiting': '已录下，还没有转写',
    'waitingBody': '这段录音安全地存在这台设备上。接入一个转写服务，它就会被读出来。',
    'waitingCta': '接入转写服务',
  },
});

registerStrings('library', {
  en: {
    'recordCta': 'Record',
    'recoveredTitle': 'We saved your recording up to {time}.',
    'recoveredBody': 'The app closed while recording on {date}. The tape up to that point is intact.',
    'recoveredRestore': 'Restore it',
    'recoveredDiscard': 'Discard',
  },
  'zh-CN': {
    'recordCta': '录音',
    'recoveredTitle': '你的录音已保存到 {time}。',
    'recoveredBody': '{date} 录音时应用被关闭了。到那一刻为止的录音完好无损。',
    'recoveredRestore': '恢复它',
    'recoveredDiscard': '丢弃',
  },
});

/* ------------------------------------------------- v3 B3: playback + review */

registerStrings('interview', {
  en: {
    'skipBack': 'Back 15 seconds',
    'skipForward': 'Forward 15 seconds',
    'skipSilence': 'Skip silence',
    'onlyNotes': 'Only notes',
    'reviewTitle': 'Review your marks ({n})',
    'reviewPlaceholder': 'What was this moment?',
    'reviewKeep': 'Keep',
    'followBack': 'Back to the voice',
    'aiWaiting': 'A summary is already written for this one',
    'reviewRemove': 'Remove',
  },
  'zh-CN': {
    'skipBack': '后退 15 秒',
    'skipForward': '前进 15 秒',
    'skipSilence': '跳过静音',
    'onlyNotes': '只听标记',
    'reviewTitle': '整理你的标记（{n}）',
    'reviewPlaceholder': '这一刻是什么？',
    'reviewKeep': '保留',
    'followBack': '回到当前句',
    'aiWaiting': '这一条已经写好了摘要',
    'reviewRemove': '删除',
  },
});

/* -------------------------------------------- v3 B4: transcript tools */

registerStrings('interview', {
  en: {
    'searchPlaceholder': 'Search the transcript',
    'searchCount': '{at} of {n}',
    'searchNone': 'no matches',
    'searchPrev': 'Previous match',
    'searchNext': 'Next match',
    'replaceToggle': 'Replace',
    'replacePlaceholder': 'Replace with',
    'replaceAll': 'Replace all',
    'replaceDone': 'Replaced {n}.',
    'replaceMismatch': 'Replace word-for-word: use the same number of words.',
    'undo': 'Undo edit',
    'redo': 'Redo edit',
    'editWord': 'Fix this word',
  },
  'zh-CN': {
    'searchPlaceholder': '搜索转写',
    'searchCount': '{at} / {n}',
    'searchNone': '没有匹配',
    'searchPrev': '上一个',
    'searchNext': '下一个',
    'replaceToggle': '替换',
    'replacePlaceholder': '替换为',
    'replaceAll': '全部替换',
    'replaceDone': '已替换 {n} 处。',
    'replaceMismatch': '逐词替换：请用相同数量的词。',
    'undo': '撤销编辑',
    'redo': '重做编辑',
    'editWord': '修正这个词',
  },
});

registerStrings('settings', {
  en: {
    'vocabulary': 'Vocabulary',
    'vocabularyWhy': 'Course terms and names, one per line. Sent with every transcription so they arrive spelled right.',
  },
  'zh-CN': {
    'vocabulary': '自定义词表',
    'vocabularyWhy': '课程术语和人名，一行一个。每次转写都会带上，让它们第一次就写对。',
  },
});

/* --------------------------------------------------- v3 B5: the AI layer */

registerStrings('interview', {
  en: {
    'tabAi': 'Summary',
  },
  'zh-CN': {
    'tabAi': '摘要',
  },
});

registerStrings('ai', {
  en: {
    'summary': 'Summary',
    'chapters': 'Chapters',
    'concepts': 'Key concepts',
    'flags': 'Flagged moments',
    'generate': 'Read it back',
    'generateWhy': 'A summary, chapters and key concepts — every claim carries a press-to-hear citation.',
    'regenerate': 'Read it again',
    'generating': 'Reading it back…',
    'failed': 'The provider could not read this one. Try again in a moment.',
    'connectWhy': 'Summaries need a notes provider. The transcript and your notes work without one.',
    'connectCta': 'Connect a provider',
    'notYet': 'The summary comes once the recording has been transcribed.',
  },
  'zh-CN': {
    'summary': '摘要',
    'chapters': '章节',
    'concepts': '关键概念',
    'flags': '标记时刻',
    'generate': '读一遍',
    'generateWhy': '摘要、章节、关键概念——每个论断都带一个按下即听的引用。',
    'regenerate': '重新读一遍',
    'generating': '正在读…',
    'failed': '服务这次没读成。稍后再试一次。',
    'connectWhy': '生成摘要需要接入笔记服务。转写和你自己的笔记不需要。',
    'connectCta': '接入服务',
    'notYet': '录音转写完成后，摘要才会出现。',
  },
});

/* ------------------------------------------------ v3 B6: Library and Home */

registerStrings('library', {
  en: {
    'thesis': 'Your notes, pinned to the moment they were said. Audio never leaves this device unless you connect a provider.',
    'eyebrow': 'Your listening, made checkable',
    'intro': 'Keep the useful line. Press its receipt. Hear the source.',
    'proofKicker': 'One note. One receipt.',
    'proofAction': 'Hear the source',
    'openRoom': 'Open listening room',
    'starterHint': 'Real recordings for learning how proof feels.',
    'yourRecordings': 'Your recordings',
    'starterLibrary': 'Starter library',
    'searchPlaceholder': 'Search everything',
    'searchEmpty': 'Nothing matches yet.',
    'tagStarter': 'starter',
    'tagRecorded': 'recorded',
    'tagImported': 'imported',
  },
  'zh-CN': {
    'thesis': '你的笔记，钉在它被说出的那一刻。音频不会离开这台设备，除非你接入转写服务。',
    'eyebrow': '你的听见，都可以核对',
    'intro': '留下有用的那句话，按下它的凭据，听回原声。',
    'proofKicker': '一条笔记，一份凭据',
    'proofAction': '听回原声',
    'openRoom': '打开听证室',
    'starterHint': '用真实录音，感受一条笔记如何自证。',
    'yourRecordings': '你的录音',
    'starterLibrary': '起步内容库',
    'searchPlaceholder': '搜索全部内容',
    'searchEmpty': '还没有匹配的内容。',
    'tagStarter': '内容库',
    'tagRecorded': '录音',
    'tagImported': '导入',
  },
});

registerStrings('interview', {
  en: {
    'badgePd': 'Public domain',
    'badgeCc': 'CC BY-NC-SA 3.0',
  },
  'zh-CN': {
    'badgePd': '公有领域',
    'badgeCc': 'CC BY-NC-SA 3.0',
  },
});

registerStrings('settings', {
  en: {
    'contentCredits': 'Starter library sources',
  },
  'zh-CN': {
    'contentCredits': '起步内容库来源',
  },
});

/* ----------------------------------------------------- v3 B7: export suite */

registerStrings('exportSheet', {
  en: {
    'formats': 'Download as',
    'htmlShare': 'HTML (share)',
    'audio': 'Audio file',
    'withTranscript': 'Include full transcript',
    'summaryOnly': 'Summary only (no transcript)',
    'summaryOnlyWhy': 'For sharing: the document, not the tape.',
    'saved': 'Saved.',
  },
  'zh-CN': {
    'formats': '下载为',
    'htmlShare': 'HTML（分享）',
    'audio': '音频原件',
    'withTranscript': '包含全文转写',
    'summaryOnly': '仅摘要（不含转写）',
    'summaryOnlyWhy': '用于分享：给文档，不给磁带。',
    'saved': '已保存。',
  },
});

/* ------------------------------------- v3 B11: favorites, trash, resume */

registerStrings('action', {
  en: {
    'favorite': 'Add to favorites',
    'unfavorite': 'Remove from favorites',
    'moveToTrash': 'Move to trash',
  },
  'zh-CN': {
    'favorite': '加入收藏',
    'unfavorite': '取消收藏',
    'moveToTrash': '移到回收站',
  },
});

registerStrings('library', {
  en: {
    'resumeAt': 'resume at {at}',
    'trash': 'Trash ({n})',
    'trashedOn': 'deleted {date}',
    'restore': 'Restore',
    'deleteForever': 'Delete forever',
    'purgeConfirm': 'Delete this recording forever? This cannot be undone.',
  },
  'zh-CN': {
    'resumeAt': '续听 {at}',
    'trash': '回收站（{n}）',
    'trashedOn': '删除于 {date}',
    'restore': '恢复',
    'deleteForever': '永久删除',
    'purgeConfirm': '永久删除这条录音？此操作不可撤销。',
  },
});

/* --------------------------------------- v3 B12: styles + saved prompts */

registerStrings('ai', {
  en: {
    'style_concise': 'Concise',
    'style_detailed': 'Detailed',
    'style_study': 'Study guide',
    'prompts': 'Ask this recording',
    'promptPlaceholder': 'Ask your own question — Enter runs and saves it',
    'asking': 'Reading the tape…',
    'preset1': 'Quiz me on this recording',
    'preset2': 'List every definition or formula, with its conditions',
    'preset3': 'What did I miss if I only skimmed?',
    'preset4': 'What would an exam ask from this?',
  },
  'zh-CN': {
    'style_concise': '精简',
    'style_detailed': '详尽',
    'style_study': '复习提纲',
    'prompts': '问这段录音',
    'promptPlaceholder': '问你自己的问题——回车运行并保存',
    'asking': '正在读带子…',
    'preset1': '就这段录音考考我',
    'preset2': '列出所有定义或公式及其条件',
    'preset3': '如果我只是略读，我错过了什么？',
    'preset4': '考试会从这里出什么题？',
  },
});
