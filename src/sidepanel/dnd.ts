export const MIME_TABS = 'application/x-chromotion-tabs';
export const MIME_CANVAS = 'application/x-chromotion-canvas';

export const hasType = (e: React.DragEvent, type: string) => Array.from(e.dataTransfer.types).includes(type);
