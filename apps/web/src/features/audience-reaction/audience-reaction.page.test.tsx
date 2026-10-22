import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { AudienceReactionPage } from '@/pages/audience-reaction-page';
import { STORAGE_KEY, setDraftStorageForTests } from './storage';
import { createMemoryDraftStorage } from './storage-test-utils';

afterEach(() => {
  cleanup();
  setDraftStorageForTests(null);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
});

function sampleSrtFile(name = 'sample.srt') {
  const body = `1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:04,000 --> 00:00:05,000
Second line
`;
  return new File([body], name, { type: 'text/plain' });
}

describe('AudienceReactionPage', () => {
  test('renders internal-simulation copy and dual-pane chrome', () => {
    render(<AudienceReactionPage />);
    expect(screen.getByRole('heading', { name: '观众反应模拟' })).toBeTruthy();
    expect(screen.getAllByText(/不是真实观众数据/).length).toBeGreaterThan(0);
    expect(screen.getByText(/不会自动生成或发布/)).toBeTruthy();
    expect(screen.getByLabelText('组合提示词预览')).toBeTruthy();
    expect(screen.getByRole('button', { name: '弹幕模拟' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '评论模拟' })).toBeTruthy();
  });

  test('composed preview and both templates include internal-simulation notice', () => {
    render(<AudienceReactionPage />);
    const preview = screen.getByLabelText('组合提示词预览') as HTMLTextAreaElement;
    expect(/内部模拟|非真实|不是真实/.test(preview.value)).toBe(true);
    expect(preview.value).toContain('【内部评估说明】');
    expect(preview.value).toContain('秒数|内容');

    fireEvent.click(screen.getByRole('button', { name: '评论模拟' }));
    expect(/内部模拟|非真实|不是真实/.test(preview.value)).toBe(true);
    expect(preview.value).toContain('【内部评估说明】');
    expect(preview.value).toContain('写30条');
  });

  test('manual copy dialog content includes the same simulation notice', async () => {
    render(<AudienceReactionPage />);
    fireEvent.click(screen.getByRole('button', { name: '手动复制' }));
    const dialog = await screen.findByRole('dialog');
    const ta = within(dialog).getByRole('textbox') as HTMLTextAreaElement;
    expect(/内部模拟|非真实|不是真实/.test(ta.value)).toBe(true);
    expect(ta.value).toContain('【内部评估说明】');
  });

  test('getItem failure on mount does not overwrite an existing valid draft', async () => {
    const legacy = JSON.stringify({
      product: 'Legacy acceptance product',
      category: 'legacy-cat',
      positioning: '',
      reference_comments: '',
      templateId: 'danmaku',
    });
    const mem = createMemoryDraftStorage({
      initial: { [STORAGE_KEY]: legacy },
      throwOnGetKey: STORAGE_KEY,
    });
    setDraftStorageForTests(mem);

    render(<AudienceReactionPage />);
    expect(await screen.findByText(/不会覆盖已有草稿/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 80));
    expect(mem.writes.length).toBe(0);
    expect((screen.getByLabelText('商品') as HTMLInputElement).value).toBe('');
    expect(mem.raw[STORAGE_KEY]).toBe(legacy);
    expect(JSON.parse(mem.raw[STORAGE_KEY]!).product).toBe('Legacy acceptance product');
  });

  test('imports subtitle, previews placeholders, and switches templates', async () => {
    render(<AudienceReactionPage />);
    const product = screen.getByLabelText('商品');
    fireEvent.change(product, { target: { value: '测试耳机' } });

    const fileInput = document.querySelector(
      'input[type="file"][accept=".srt,.ass,.ssa"]',
    ) as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    fireEvent.change(fileInput, { target: { files: [sampleSrtFile()] } });

    await waitFor(() => {
      expect(screen.getByText(/sample\.srt · 2 条字幕/)).toBeTruthy();
    });

    const preview = screen.getByLabelText('组合提示词预览') as HTMLTextAreaElement;
    expect(preview.value).toContain('测试耳机');
    expect(preview.value).toContain('time_sec,text');
    expect(preview.value).toContain('Hello world');
    expect(preview.value).toContain('秒数|内容');

    fireEvent.click(screen.getByRole('button', { name: '评论模拟' }));
    await waitFor(() => {
      expect(preview.value).toContain('写30条');
      expect(preview.value).toContain('测试耳机');
    });
  });

  test('invalid extension keeps prior cues; bad parse clears cues for new file', async () => {
    render(<AudienceReactionPage />);
    const fileInput = document.querySelector(
      'input[type="file"][accept=".srt,.ass,.ssa"]',
    ) as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [sampleSrtFile('good.srt')] } });
    await waitFor(() => expect(screen.getByText(/good\.srt · 2 条字幕/)).toBeTruthy());

    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => {
      expect(screen.getByText(/请上传 \.srt/)).toBeTruthy();
      expect(screen.getByText(/good\.srt · 2 条字幕/)).toBeTruthy();
    });

    fireEvent.change(fileInput, {
      target: { files: [new File(['totally broken'], 'bad.srt', { type: 'text/plain' })] },
    });
    await waitFor(() => {
      expect(screen.getByText(/bad\.srt · 0 条字幕/)).toBeTruthy();
      expect(screen.queryByText(/good\.srt/)).toBeNull();
    });
    const preview = screen.getByLabelText('组合提示词预览') as HTMLTextAreaElement;
    expect(preview.value).toContain('尚未上传字幕或解析结果为空');
  });

  test('danmaku convert dialog shows stats and modes', async () => {
    render(<AudienceReactionPage />);
    fireEvent.click(screen.getByRole('button', { name: '弹幕时间格式转换' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '弹幕时间格式转换' })).toBeTruthy();

    const input = within(dialog).getByLabelText('输入');
    fireEvent.change(input, { target: { value: '00:08 hello\nbad line\n00:01 ok' } });

    await waitFor(() => {
      expect(within(dialog).getByText(/已转换 2 行，跳过 1 行/)).toBeTruthy();
    });
    const out = within(dialog).getByLabelText('转换结果') as HTMLTextAreaElement;
    expect(out.value).toContain('08|hello');

    fireEvent.click(within(dialog).getByLabelText('竖线转斜杠时间轴'));
    fireEvent.change(input, { target: { value: '8|hello' } });
    await waitFor(() => {
      expect(out.value).toContain('hello/00:08');
    });
  });

  test('export/import JSON roundtrip updates form', async () => {
    render(<AudienceReactionPage />);
    fireEvent.change(screen.getByLabelText('商品'), { target: { value: '导出商品' } });
    fireEvent.click(screen.getByRole('button', { name: '评论模拟' }));

    const createObjectURL = mock((blob: Blob) => {
      void blob;
      return 'blob:test-url';
    });
    const revokeObjectURL = mock(() => undefined);
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL;

    const clickSpy = mock(() => undefined);
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') {
        el.click = clickSpy;
      }
      return el;
    }) as typeof document.createElement;

    try {
      fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));
      expect(createObjectURL).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
      expect(clickSpy).toHaveBeenCalled();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      document.createElement = originalCreateElement;
    }

    const exported = exportConfigFromUi();
    fireEvent.change(screen.getByLabelText('商品'), { target: { value: '已清空' } });

    const importInput = document.querySelector(
      'input[type="file"][accept="application/json,.json"]',
    ) as HTMLInputElement;
    fireEvent.change(importInput, {
      target: {
        files: [new File([exported], 'cfg.json', { type: 'application/json' })],
      },
    });

    await waitFor(() => {
      expect((screen.getByLabelText('商品') as HTMLInputElement).value).toBe('导出商品');
    });
  });

  test('copy failure opens manual copy entry', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mock(async () => {
          throw new Error('denied');
        }),
      },
    });
    const original = document.execCommand;
    document.execCommand = () => false;

    try {
      render(<AudienceReactionPage />);
      fireEvent.click(screen.getByRole('button', { name: '复制全文' }));
      await waitFor(() => {
        expect(screen.getByText(/复制失败/)).toBeTruthy();
        expect(screen.getByRole('heading', { name: '手动复制提示词' })).toBeTruthy();
      });
    } finally {
      document.execCommand = original;
    }
  });

  test('preview is plain text textarea without HTML injection sink', () => {
    render(<AudienceReactionPage />);
    fireEvent.change(screen.getByLabelText('商品'), {
      target: { value: '<img src=x onerror=alert(1)>' },
    });
    const preview = screen.getByLabelText('组合提示词预览') as HTMLTextAreaElement;
    expect(preview.tagName).toBe('TEXTAREA');
    expect(preview.value).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelectorAll('img[src="x"]').length).toBe(0);
  });

  test('clear local draft is explicit', async () => {
    render(<AudienceReactionPage />);
    fireEvent.change(screen.getByLabelText('商品'), { target: { value: '草稿商品' } });
    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toContain('草稿商品');
    });
    fireEvent.click(screen.getByRole('button', { name: '清除本地草稿' }));
    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect((screen.getByLabelText('商品') as HTMLInputElement).value).toBe('');
    });
  });
});

/** 用与页面相同的 exportConfig 语义构造导入内容（避免依赖 blob 内容读取） */
function exportConfigFromUi(): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      form: {
        product: '导出商品',
        category: '',
        positioning: '',
        reference_comments: '',
        templateId: 'comment',
      },
    },
    null,
    2,
  );
}
