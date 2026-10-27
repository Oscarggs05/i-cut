import { useEditor } from '../../store/editor';
import {
  AdjustSheet, AnimationSheet, DurationSheet, EffectsSheet, FiltersSheet, OpacitySheet, SpeedSheet, TransformSheet, VolumeSheet,
} from './ClipSheets';
import { StickersSheet, TextSheet } from './TextSheets';
import { CaptionsSheet, ChromaSheet } from './ExtraSheets';
import { AudioSheet, BackgroundSheet, CanvasSheet, RecordSheet, TransitionSheet } from './ProjectSheets';

export function SheetHost() {
  const sheet = useEditor((s) => s.sheet);
  switch (sheet) {
    case 'speed': return <SpeedSheet />;
    case 'volume': return <VolumeSheet />;
    case 'duration': return <DurationSheet />;
    case 'filters': return <FiltersSheet />;
    case 'adjust': return <AdjustSheet />;
    case 'effects': return <EffectsSheet />;
    case 'animation': return <AnimationSheet />;
    case 'transform': return <TransformSheet />;
    case 'opacity': return <OpacitySheet />;
    case 'text': return <TextSheet />;
    case 'textStyle': return <TextSheet initialTab="style" />;
    case 'stickers': return <StickersSheet />;
    case 'transition': return <TransitionSheet />;
    case 'canvas': return <CanvasSheet />;
    case 'background': return <BackgroundSheet />;
    case 'audio': return <AudioSheet />;
    case 'record': return <RecordSheet />;
    case 'chroma': return <ChromaSheet />;
    case 'captions': return <CaptionsSheet />;
    default: return null;
  }
}
