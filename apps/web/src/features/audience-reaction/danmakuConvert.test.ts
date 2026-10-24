import { describe, expect, it } from 'bun:test';
import {
  convertMmssToPipeLines,
  convertPipeToSlashLines,
  convertDanmakuText,
} from './danmakuConvert';

describe('convertMmssToPipeLines', () => {
  it('parses mm:ss with space and optional brackets / Chinese colon', () => {
    const input = '00:08 hello\n[01:02] world\n02：03  x ';
    const { lines, skipped } = convertMmssToPipeLines(input);
    expect(lines).toEqual(['08|hello', '62|world', '123|x']);
    expect(skipped).toBe(0);
  });

  it('skips blank and invalid lines', () => {
    const input = '\nnot a time line\n00:08 ok\n';
    const { lines, skipped } = convertMmssToPipeLines(input);
    expect(lines).toEqual(['08|ok']);
    expect(skipped).toBe(1);
  });

  it('pads total seconds like Python :02d minimum width', () => {
    expect(convertMmssToPipeLines('00:05 a').lines[0]).toBe('05|a');
    expect(convertMmssToPipeLines('10:00 b').lines[0]).toBe('600|b');
  });
});

describe('convertPipeToSlashLines', () => {
  it('converts sec|content to content/mm:ss', () => {
    const input = '334|硬币就给你啦\n8|hi';
    const { lines, skipped } = convertPipeToSlashLines(input);
    expect(lines).toEqual(['硬币就给你啦/05:34', 'hi/00:08']);
    expect(skipped).toBe(0);
  });

  it('splits on first pipe only', () => {
    const { lines } = convertPipeToSlashLines('10|a|b');
    expect(lines).toEqual(['a|b/00:10']);
  });

  it('skips lines without pipe or non-digit sec or empty content', () => {
    const { lines, skipped } = convertPipeToSlashLines('abc|x\n10|\n|y\n5|ok');
    expect(lines).toEqual(['ok/00:05']);
    expect(skipped).toBe(3);
  });
});

describe('convertDanmakuText', () => {
  it('dispatches by mode', () => {
    expect(convertDanmakuText('00:01 x', 'mmssToPipe').lines).toEqual(['01|x']);
    expect(convertDanmakuText('1|y', 'pipeToSlash').lines).toEqual(['y/00:01']);
  });
});
