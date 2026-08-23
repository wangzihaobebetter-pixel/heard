/**
 * Starter library registry — the eight recordings v3 ships (PRODUCT-SPEC §5).
 *
 * Every fact here (URLs, licences, credit lines, dates) is sourced and
 * verified in memory/heard-v3/research/content-sources.md and re-audited in
 * memory/heard-v3/research/material-audit.md; nothing in this file is guessed.
 * `scripts/build-content.mjs` reads this registry plus the raw material in
 * heard-build/content/<id>/ and emits public/starter/ + src/content/manifest.json.
 *
 * `official` names the transcript format sitting in heard-build/content/<id>/:
 * 'html' → official.html (page with the publisher's verbatim transcript),
 * 'xml' → official.xml (Library of Congress TEI, with speaker labels).
 *
 * `minCorroboration` overrides the per-quote Layer-2 gate only where the audit
 * showed the official transcript legitimately diverges from what the tape says
 * (1935 field recording, dialect + disc noise — see material-audit.md §5).
 */

/** All build-time timestamps (note createdAt etc.) are pinned to the build date. */
export const CONTENT_DATE = '2026-08-23';
export const CONTENT_V = 1;

export const ENTRIES = [
  {
    id: 'reagan-challenger',
    title: 'The Challenger Address',
    speaker: 'Ronald Reagan',
    occasion: 'Address to the Nation from the Oval Office, 28 January 1986',
    recordedAt: '1986-01-28',
    category: 'speech',
    lang: 'en',
    official: 'html',
    license: 'public-domain',
    commercialUse: true,
    blurb: 'Four minutes, written in hours, delivered to schoolchildren who had just watched a teacher die on live television.',
    credit: 'Ronald Reagan, "Address to the Nation on the Explosion of the Space Shuttle Challenger," 28 January 1986. Ronald Reagan Presidential Library, National Archives and Records Administration (PP6028B). Public domain (work of the U.S. Government).',
    audioSource: 'https://archive.org/download/presidentronaldreagansspeechonspaceshuttlechallenger/President%20Ronald%20Reagans%20Speech%20on%20Space%20Shuttle%20Challenger.mp3',
    officialSource: 'https://www.reaganlibrary.gov/archives/speech/address-nation-explosion-space-shuttle-challenger',
  },
  {
    id: 'noaa-meteotsunami',
    title: 'Meteotsunamis',
    speaker: 'NOAA Ocean Podcast',
    occasion: 'NOAA Ocean Podcast, episode 70',
    recordedAt: '2023-11-01',
    category: 'science',
    lang: 'en',
    official: 'html',
    license: 'public-domain',
    commercialUse: true,
    blurb: 'A tsunami caused by weather instead of an earthquake — and it can happen on the Great Lakes.',
    credit: 'NOAA Ocean Podcast, "Meteotsunamis" (Episode 70). U.S. National Oceanic and Atmospheric Administration, National Ocean Service. Public domain (work of the U.S. Government).',
    audioSource: 'https://oceanservice.noaa.gov/podcast/nov23/nop70-meteotsunami.mp3',
    officialSource: 'https://oceanservice.noaa.gov/podcast/nov23/nop70-meteotsunamis.html',
  },
  {
    id: 'fdr-infamy',
    title: 'Day of Infamy',
    speaker: 'Franklin D. Roosevelt',
    occasion: 'Address to a Joint Session of Congress, 8 December 1941',
    recordedAt: '1941-12-08',
    category: 'speech',
    lang: 'en',
    official: 'html',
    license: 'public-domain',
    commercialUse: true,
    blurb: 'Nine minutes engineered word by word for one purpose: a declaration of war.',
    credit: 'Franklin D. Roosevelt, Address to Congress, 8 December 1941. Franklin D. Roosevelt Presidential Library and Museum. Public domain (work of the U.S. Government).',
    audioSource: 'https://archive.org/download/FranklinDelanoRooseveltDayOfInfamySpeech/FDR_pearlharborspeech.mp3',
    officialSource: 'https://millercenter.org/the-presidency/presidential-speeches/december-8-1941-address-congress-requesting-declaration-war',
  },
  {
    id: 'noaa-rip-currents',
    title: 'Rip Currents: Preparedness and Prevention',
    speaker: 'NOAA Ocean Podcast',
    occasion: 'NOAA Ocean Podcast, episode 66 — Marissa Anderson with Dr. Gregory Dusek',
    recordedAt: '2023-06-01',
    category: 'science',
    lang: 'en',
    official: 'html',
    license: 'public-domain',
    commercialUse: true,
    blurb: 'Rip currents kill more Americans most years than sharks, tornadoes and lightning combined — and the escape move is counter-intuitive.',
    credit: 'NOAA Ocean Podcast, "Rip Currents: Preparedness and Prevention" (Episode 66). U.S. National Oceanic and Atmospheric Administration, National Ocean Service. Public domain (work of the U.S. Government).',
    audioSource: 'https://oceanservice.noaa.gov/podcast/june23/nop66-rip-currents.mp3',
    officialSource: 'https://oceanservice.noaa.gov/podcast/june23/nop66-rip-currents.html',
  },
  {
    id: 'loc-quarterman',
    title: 'Wallace Quarterman (1935)',
    speaker: 'Wallace Quarterman',
    occasion: 'Interviewed by Alan Lomax and Zora Neale Hurston, Fort Frederica, St. Simons Island, Georgia, June 1935',
    recordedAt: '1935-06-01',
    category: 'oral-history',
    lang: 'en',
    official: 'xml',
    license: 'public-domain',
    commercialUse: true,
    // The 1935 disc is rough and the dialect is strong; ASR word forms are
    // often wrong even where the timeline is right (material-audit §5). The
    // official LOC transcript is the readable text; quotes are gated lower and
    // the entry carries a context note instead of pretending ASR accuracy.
    minCorroboration: 0.6,
    contextNote: 'A 1935 field recording of Wallace Quarterman, who was born into slavery, interviewed by Alan Lomax and Zora Neale Hurston. The disc is worn and the automatic transcript struggles with the audio; the Library of Congress transcript is the authoritative text. Presented with respect, as the Library asks, for the people whose lives are documented here.',
    blurb: 'An irreplaceable primary source: a man born into slavery, recorded on disc in 1935.',
    credit: 'Interview with Wallace Quarterman, Fort Frederica, St. Simons Island, Georgia, June 1935. Alan Lomax, Zora Neale Hurston, and Mary Elizabeth Barnicle Expedition Collection (AFC 1935/001), American Folklife Center, Library of Congress.',
    audioSource: 'https://www.loc.gov/collections/interviews-with-former-slaves/ (AFC 1935/001)',
    officialSource: 'Library of Congress TEI transcript, same item (official.xml)',
  },
  {
    id: 'jfk-moon',
    title: 'We Choose to Go to the Moon',
    speaker: 'John F. Kennedy',
    occasion: 'Address on the Nation’s Space Effort, Rice University, Houston, 12 September 1962',
    recordedAt: '1962-09-12',
    category: 'speech',
    lang: 'en',
    official: 'html',
    license: 'public-domain',
    commercialUse: true,
    blurb: 'The most-quoted "why do hard things" argument ever made — with the crowd laughing at the jokes.',
    credit: 'John F. Kennedy, "Address at Rice University on the Nation’s Space Effort," 12 September 1962. White House recording, John F. Kennedy Presidential Library and Museum. Public domain (work of the U.S. Government).',
    audioSource: 'https://archive.org/download/jfks19620912/jfk_1962_0912_spaceeffort.mp3',
    officialSource: 'https://er.jsc.nasa.gov/seh/ricetalk.htm (via Wayback snapshot 20220714033204)',
  },
  {
    id: 'obama-students',
    title: 'A Message for America’s Students',
    speaker: 'Barack Obama',
    occasion: 'National address to schoolchildren, Wakefield High School, Arlington VA, 8 September 2009',
    recordedAt: '2009-09-08',
    category: 'speech',
    lang: 'en',
    official: 'html',
    license: 'public-domain',
    commercialUse: true,
    blurb: 'A "here is how to be a student" address actually addressed to students.',
    credit: 'Barack Obama, "A Message for America’s Students," 8 September 2009. The White House. Public domain (work of the U.S. Government).',
    audioSource: 'https://archive.org/download/PresidentObamaBackToSchoolEvent/President_Obama_s_Message_for_America_s_Students.mp3',
    officialSource: 'https://obamawhitehouse.archives.gov/the-press-office/remarks-president-a-national-address-americas-schoolchildren',
  },
  {
    id: 'yale-psych110',
    title: 'Introduction to Psychology, Lecture 1',
    speaker: 'Paul Bloom',
    occasion: 'PSYC 110, Yale University, Spring 2007 — Lecture 1: Introduction',
    recordedAt: '2007-01-17',
    category: 'lecture',
    lang: 'en',
    official: 'html',
    license: 'cc-by-nc-sa-3.0',
    // Yale's terms §5: Open Yale Courses material may not be commercialised.
    // Heard must remain free while this item is bundled.
    commercialUse: false,
    blurb: 'Why are some faces attractive, why do we dream, is there free will — a real lecture at real lecture length.',
    credit: 'Paul Bloom, Introduction to Psychology (Yale University: Open Yale Courses), http://oyc.yale.edu (Accessed 23 August 2026). License: Creative Commons BY-NC-SA',
    audioSource: 'https://oyc.yale.edu/sites/default/files/courses/spring07/psyc110/mp3/psyc110_01_011707.mp3',
    officialSource: 'https://oyc.yale.edu/psychology/psyc-110/lecture-1',
  },
];
