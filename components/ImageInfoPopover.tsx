import React from 'react';
import { GeneratedImage } from '../types';

interface ImageInfoPopoverProps {
  image: GeneratedImage;
}

export const ImageInfoPopover: React.FC<ImageInfoPopoverProps> = ({ image }) => {
  const size = image.params.imageSize || 'STD';
  const ratio = image.params.aspectRatio || 'auto';
  const time = new Date(image.timestamp).toLocaleString();

  return (
    <div className="aurora-image-popover">
      <div className="aurora-image-popover-title">提示词</div>
      <p className="aurora-image-popover-prompt">{image.prompt}</p>
      <div className="aurora-image-popover-meta">
        <div>
          <span>模型</span>
          <span>{image.model || '-'}</span>
        </div>
        <div>
          <span>尺寸</span>
          <span>{size}</span>
        </div>
        <div>
          <span>比例</span>
          <span>{ratio}</span>
        </div>
        <div>
          <span>时间</span>
          <span>{time}</span>
        </div>
      </div>
    </div>
  );
};
