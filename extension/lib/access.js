"use strict";
// Answers "what can gh-viewer actually read for me?".
//
// Worth its own screen because nothing else answers it. The App's settings page
// only shows this to people who administer the account, so a member of an org
// someone else set up has no way to tell an App that is missing from their org
// from one that is installed but scoped to other repositories - the two look
// identical from the sidebar, which is an empty list either way.
globalThis.GV = globalThis.GV || {};

(function () {
  const PER_PAGE = 100;
  // 1000 repositories in. Past that the list is not what is wrong.
  const MAX_PAGES = 10;

  async function repositories(installationId) {
    const repos = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = await GV.api.rest(
        `/user/installations/${installationId}/repositories` +
        `?per_page=${PER_PAGE}&page=${page}`);
      const batch = body.repositories || [];
      repos.push(...batch);
      if (batch.length < PER_PAGE) return { repos, truncated: false };
    }
    return { repos, truncated: true };
  }

  GV.access = {
    // One request for the installations, then one per installation per page of
    // repositories. Costs rate-limit points, so it runs on request rather than
    // on load.
    async list() {
      const body = await GV.api.rest("/user/installations");

      return Promise.all((body.installations || []).map(async (installation) => {
        const account = installation.account || {};
        const entry = {
          id: installation.id,
          account: account.login || "(unknown account)",
          type: account.type || "",
          // "all" covers repositories created after the App was installed too,
          // which is the difference that surprises people.
          everyRepository: installation.repository_selection === "all",
          repositories: [],
          truncated: false,
          error: null,
        };

        try {
          const { repos, truncated } = await repositories(installation.id);
          entry.repositories = repos
            .map((repo) => ({ name: repo.full_name, private: Boolean(repo.private) }))
            .sort((a, b) => a.name.localeCompare(b.name));
          entry.truncated = truncated;
        } catch (e) {
          // One unreadable installation must not hide the others.
          entry.error = e.message;
        }
        return entry;
      }));
    },
  };
})();
