export class NativeCropReview {
  mediaId: string = '';
  label: string = '';
  capturedAt: number = 0;
  status: string = '';
  revision: number = 0;
  plot: string = '';
  note: string = '';
  source: string = '';
  reviewedAt: number | null = null;
  regionCount: number = 0;
}
export class NativeCropInbox {
  schemaVersion: number = 0;
  gatewayId: string = '';
  readOnly: boolean = false;
  historical: boolean = false;
  isCurrent: boolean = true;
  multispectralConnected: boolean = true;
  indicesAvailable: boolean = true;
  scope: string = '';
  readAt: number = 0;
  items: NativeCropReview[] = [];
}
export function parseCropInbox(text: string, expectedId: string): NativeCropInbox {
  const data = JSON.parse(text) as NativeCropInbox;
  if (!data || data.schemaVersion !== 1 || data.gatewayId !== expectedId || data.readOnly !== true || data.historical !== true || data.isCurrent !== false || data.multispectralConnected !== false || data.indicesAvailable !== false || data.scope !== 'latest-10-crop-images' || !Number.isSafeInteger(data.readAt) || data.readAt <= 0 || !Array.isArray(data.items) || data.items.length > 10) throw new Error('作物复核收件箱协议无效');
  const ids: string[] = [];
  for (const row of data.items) {
    if (!row || typeof row.mediaId !== 'string' || !/^[a-f0-9-]{36}$/.test(row.mediaId) || ids.includes(row.mediaId) || typeof row.label !== 'string' || !row.label.trim() || row.label.length > 120 || !Number.isSafeInteger(row.capturedAt) || row.capturedAt <= 0 || !['unreviewed','suspected','confirmed','clear'].includes(row.status) || !Number.isSafeInteger(row.revision) || row.revision < 0 || typeof row.plot !== 'string' || row.plot.length > 80 || typeof row.note !== 'string' || row.note.length > 800 || !Number.isSafeInteger(row.regionCount) || row.regionCount < 0 || row.regionCount > 10) throw new Error('作物复核记录无效');
    if (row.revision === 0) {
      if (row.source !== 'none' || row.status !== 'unreviewed' || row.reviewedAt !== null || row.regionCount !== 0 || row.note !== '' || row.plot !== '') throw new Error('未复核记录来源无效');
    } else if (row.source !== 'manual' || !Number.isSafeInteger(row.reviewedAt) || (row.reviewedAt as number) <= 0 || (row.reviewedAt as number) > data.readAt || (['suspected','confirmed'].includes(row.status) && !row.note.trim()) || (['unreviewed','clear'].includes(row.status) && row.regionCount !== 0)) throw new Error('人工复核来源无效');
    ids.push(row.mediaId);
  }
  return data;
}
export function cropReviewLabel(status: string): string {
  if (status === 'suspected') return '疑似异常';
  if (status === 'confirmed') return '确认异常';
  if (status === 'clear') return '本次未见异常';
  return '待复核';
}
