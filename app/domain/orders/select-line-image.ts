// SRS-adjacent rule (Section on product images): prefer the variant image,
// then the product's featured image, then no image at all. A missing image
// must never fail the whole order import — this just returns null.

export interface LineImageCandidates {
  variantImageUrl: string | null | undefined;
  productFeaturedImageUrl: string | null | undefined;
}

export function selectLineImage(candidates: LineImageCandidates): string | null {
  return candidates.variantImageUrl ?? candidates.productFeaturedImageUrl ?? null;
}
