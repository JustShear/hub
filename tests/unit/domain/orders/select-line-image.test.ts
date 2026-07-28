import { describe, expect, it } from "vitest";
import { selectLineImage } from "~/domain/orders/select-line-image";

describe("selectLineImage", () => {
  it("prefers the variant image when both are available", () => {
    const url = selectLineImage({
      variantImageUrl: "https://cdn.shopify.com/variant.png",
      productFeaturedImageUrl: "https://cdn.shopify.com/product.png",
    });
    expect(url).toBe("https://cdn.shopify.com/variant.png");
  });

  it("falls back to the product featured image when there's no variant image", () => {
    const url = selectLineImage({
      variantImageUrl: null,
      productFeaturedImageUrl: "https://cdn.shopify.com/product.png",
    });
    expect(url).toBe("https://cdn.shopify.com/product.png");
  });

  it("returns null when neither image is available, rather than throwing", () => {
    const url = selectLineImage({ variantImageUrl: null, productFeaturedImageUrl: null });
    expect(url).toBeNull();
  });

  it("treats undefined the same as null for both fields", () => {
    const url = selectLineImage({ variantImageUrl: undefined, productFeaturedImageUrl: undefined });
    expect(url).toBeNull();
  });
});
