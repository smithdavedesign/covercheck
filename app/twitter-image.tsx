import { SHARE_IMAGE_ALT, SHARE_IMAGE_SIZE, SHARE_IMAGE_TYPE } from '../lib/seo';
import { shareImage } from './share-image';

export const alt = SHARE_IMAGE_ALT;
export const size = SHARE_IMAGE_SIZE;
export const contentType = SHARE_IMAGE_TYPE;

export default function Image() {
  return shareImage();
}
