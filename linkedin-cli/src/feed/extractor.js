const POST_SELECTORS = [
  ".feed-shared-update-v2",
  'div[data-urn*="urn:li:activity"]',
  ".update-components-update-v2",
  ".reusable-search__result-container",
  ".search-result__wrapper",
  "li.reusable-search__result-container",
];

async function extractPosts(page, source = "feed", searchQuery = null) {
  return page.evaluate(
    ({ selectors, source, searchQuery }) => {
      const seen = new Set();
      const results = [];

      function pickPostUrl(el) {
        const links = el.querySelectorAll("a[href]");
        for (const link of links) {
          const href = link.href || "";
          if (
            href.includes("/feed/update/") ||
            href.includes("urn:li:activity") ||
            href.includes("/posts/") ||
            href.includes("/pulse/")
          ) {
            return href.split("?")[0];
          }
        }
        const urn = el.getAttribute("data-urn");
        if (urn) return `https://www.linkedin.com/feed/update/${urn}/`;
        return null;
      }

      function pickAuthor(el) {
        const authorEl =
          el.querySelector(".update-components-actor__name span[aria-hidden='true']") ||
          el.querySelector(".update-components-actor__name") ||
          el.querySelector(".feed-shared-actor__name") ||
          el.querySelector(".entity-result__title-text a span[aria-hidden='true']") ||
          el.querySelector(".entity-result__title-text");
        return authorEl?.innerText?.trim() || null;
      }

      function pickAuthorProfile(el) {
        const profileLink = el.querySelector(
          ".update-components-actor__meta-link, a.update-components-actor__image, a.feed-shared-actor__container-link, a.app-aware-link[href*='/in/']"
        );
        const href = profileLink?.href || null;
        return href ? href.split("?")[0] : null;
      }

      function pickText(el) {
        const textEl =
          el.querySelector(".feed-shared-update-v2__description") ||
          el.querySelector(".update-components-text") ||
          el.querySelector(".feed-shared-text") ||
          el.querySelector(".entity-result__summary") ||
          el.querySelector(".linked-area");
        return textEl?.innerText?.trim() || null;
      }

      function pickPosted(el) {
        const timeEl =
          el.querySelector(".update-components-actor__sub-description span") ||
          el.querySelector("span.update-components-actor__sub-description") ||
          el.querySelector(".entity-result__secondary-subtitle");
        return timeEl?.innerText?.trim() || null;
      }

      for (const selector of selectors) {
        for (const el of document.querySelectorAll(selector)) {
          const urn = el.getAttribute("data-urn") || el.dataset?.urn;
          const text = pickText(el);
          if (!text || text.length < 20) continue;

          const key = urn || pickPostUrl(el) || text.slice(0, 80);
          if (seen.has(key)) continue;
          seen.add(key);

          results.push({
            urn: urn || key,
            post_text: text,
            author_name: pickAuthor(el),
            author_profile: pickAuthorProfile(el),
            post_url: pickPostUrl(el),
            posted: pickPosted(el),
            source,
            search_query: searchQuery,
          });
        }
      }

      return results;
    },
    { selectors: POST_SELECTORS, source, searchQuery }
  );
}

module.exports = { extractPosts };
