import '@shopify/ui-extensions/preact';
import {render} from 'preact';

// TEMPORARY DIAGNOSTIC - proves whether Shopify runs this extension at all.
export default async () => {
  console.log('customer-proofs HelloPage: render called');
  render(
    <s-page heading="Hello from the Hub">
      <s-text>If you can read this, the extension is running.</s-text>
    </s-page>,
    document.body,
  );
};
