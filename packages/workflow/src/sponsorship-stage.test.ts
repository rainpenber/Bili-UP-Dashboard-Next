import { describe, expect, test } from 'bun:test';
import { resolveSponsorshipStage } from './sponsorship-stage';

describe('resolveSponsorshipStage', () => {
  test('starts at intake', () => {
    expect(
      resolveSponsorshipStage({
        briefAccepted: false,
        scriptApproved: false,
        videoUploaded: false,
        clientSignedOff: false,
        publishedAt: null,
      }),
    ).toBe('intake');
  });

  test('moves through brief and production', () => {
    expect(
      resolveSponsorshipStage({
        briefAccepted: true,
        scriptApproved: false,
        videoUploaded: false,
        clientSignedOff: false,
        publishedAt: null,
      }),
    ).toBe('brief_review');

    expect(
      resolveSponsorshipStage({
        briefAccepted: true,
        scriptApproved: true,
        videoUploaded: false,
        clientSignedOff: false,
        publishedAt: null,
      }),
    ).toBe('production');
  });

  test('published when publishedAt is set', () => {
    expect(
      resolveSponsorshipStage({
        briefAccepted: true,
        scriptApproved: true,
        videoUploaded: true,
        clientSignedOff: true,
        publishedAt: '2026-06-01T12:00:00.000Z',
      }),
    ).toBe('published');
  });
});
