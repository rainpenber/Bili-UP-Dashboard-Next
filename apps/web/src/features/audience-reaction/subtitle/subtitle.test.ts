import { describe, expect, it } from 'bun:test';
import { cuesToCsv } from './csv';
import { parseAss } from './parseAss';
import { parseSrt } from './parseSrt';
import { detectSubtitleFormat, parseSubtitleFile } from './index';
import { parseAssTimestamp, parseSrtTimestamp } from './time';

describe('parseSrtTimestamp', () => {
  it('parses standard', () => {
    expect(parseSrtTimestamp('00:00:01,234')).toBeCloseTo(1.234, 3);
    expect(parseSrtTimestamp('01:02:03,000')).toBe(3723);
  });

  it('rejects malformed', () => {
    expect(() => parseSrtTimestamp('bad')).toThrow(/无效的 SRT 时间/);
  });
});

describe('parseSrt', () => {
  it('parses two cues', () => {
    const s = `1
00:00:01,000 --> 00:00:03,000
Hello

2
00:00:05,500 --> 00:00:08,000
Line two
`;
    const cues = parseSrt(s);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.startSec).toBe(1);
    expect(cues[0]!.text).toBe('Hello');
    expect(cues[1]!.text).toBe('Line two');
  });

  it('strips HTML-like tags', () => {
    const s = `1
00:00:00,000 --> 00:00:01,000
<b>Hi</b>
`;
    expect(parseSrt(s)[0]!.text).toBe('Hi');
  });

  it('returns empty for garbage content', () => {
    expect(parseSrt('not a subtitle\nat all')).toEqual([]);
  });
});

describe('parseAss', () => {
  it('parses Dialogue line', () => {
    const s = `[Script Info]
Title: t

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.23,0:00:03.45,Default,,0,0,0,,Hello, world
`;
    const cues = parseAss(s);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.text).toBe('Hello, world');
    expect(cues[0]!.startSec).toBeCloseTo(1.23, 2);
  });
});

describe('cuesToCsv', () => {
  it('escapes and includes header', () => {
    const csv = cuesToCsv(
      [
        { startSec: 1, endSec: 2, text: 'say "hi"' },
        { startSec: 3.5, endSec: 4, text: 'a,b' },
      ],
      { includeHeader: true },
    );
    expect(csv).toContain('time_sec,text');
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"a,b"');
  });
});

describe('parseAssTimestamp', () => {
  it('parses', () => {
    expect(parseAssTimestamp('0:00:01.23')).toBeCloseTo(1.23, 2);
  });
});

describe('parseSubtitleFile', () => {
  it('detects by extension', () => {
    expect(detectSubtitleFormat('a.srt', '')).toBe('srt');
    expect(detectSubtitleFormat('a.ass', '')).toBe('ass');
    expect(detectSubtitleFormat('a.ssa', '')).toBe('ass');
  });

  it('parses srt by filename', () => {
    const cues = parseSubtitleFile(
      'x.srt',
      `1
00:00:00,000 --> 00:00:01,000
Hi
`,
    );
    expect(cues[0]!.text).toBe('Hi');
  });
});
