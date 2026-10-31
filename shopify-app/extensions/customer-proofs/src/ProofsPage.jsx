import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

// The Hub's public address - the same value as APP_BASE_URL on Render - with
// no trailing slash. Set this before deploying the extension.
const HUB_URL = 'https://hub-p237.onrender.com';

export default async () => {
  render(<ProofsPage />, document.body);
};

function formatDate(iso) {
  try {
    return shopify.i18n.formatDate(new Date(iso), {dateStyle: 'medium'});
  } catch {
    return String(iso).slice(0, 10);
  }
}

function ProofsPage() {
  const [state, setState] = useState({status: 'loading', proofs: []});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (HUB_URL.includes('REPLACE-WITH')) {
        setState({status: 'error', proofs: []});
        return;
      }
      try {
        // A fresh token for every request - they only live a few minutes.
        const token = await shopify.sessionToken.get();
        const response = await fetch(`${HUB_URL}/api/customer-account/proofs`, {
          headers: {Authorization: `Bearer ${token}`},
        });
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        const body = await response.json();
        if (!cancelled) {
          setState({status: 'ready', proofs: body.proofs ?? []});
        }
      } catch (error) {
        console.error('Could not load approved proofs', error);
        if (!cancelled) {
          setState({status: 'error', proofs: []});
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <s-page
      heading="My approved proofs"
      subheading="The final artwork you have approved with us."
      inlineSize="large"
    >
      {state.status === 'loading' ? (
        <s-stack alignItems="center" padding="large">
          <s-spinner accessibilityLabel="Loading your approved proofs" />
        </s-stack>
      ) : null}

      {state.status === 'error' ? (
        <s-banner tone="critical" heading="We couldn't load your proofs">
          <s-text>Please try again in a moment, or contact us if this keeps happening.</s-text>
        </s-banner>
      ) : null}

      {state.status === 'ready' && state.proofs.length === 0 ? (
        <s-text>
          You don't have any approved proofs yet. Once you approve a proof, it will appear here.
        </s-text>
      ) : null}

      {state.status === 'ready' && state.proofs.length > 0 ? (
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(200px, 1fr))" gap="base">
          {state.proofs.map((proof) => (
            <s-section key={proof.id}>
              <s-stack direction="block" gap="small-300">
                {proof.imageUrl ? (
                  <s-image
                    src={proof.imageUrl}
                    alt={`${proof.artworkName} - approved proof`}
                    aspectRatio="1/1"
                    objectFit="contain"
                    borderRadius="base"
                  />
                ) : (
                  <s-text color="subdued">No preview available</s-text>
                )}
                <s-text type="strong">{proof.artworkName}</s-text>
                <s-text color="subdued">
                  Order {proof.orderNumber} · {proof.method}
                </s-text>
                <s-text color="subdued">Approved {formatDate(proof.approvedAt)}</s-text>
              </s-stack>
            </s-section>
          ))}
        </s-grid>
      ) : null}
    </s-page>
  );
}
