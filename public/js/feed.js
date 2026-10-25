/**
 * Home page feed: AJAX article list with infinite scroll, live search, category and
 * read / unread filters, sorting, and the weather widget.
 */

document.addEventListener('DOMContentLoaded', () => {

    // ── Feed State ──────────────────────────────────────────────────────────
    let currentPage = 1;
    const limit = 20; // 20 articles per page as required in the project spec
    let isLoading = false;
    let hasMore = true;
    let currentCategory = 'all';
    let currentSearch = '';
    let currentSort = 'date_desc';
    let currentViewed = 'all'; // 'all', 'viewed', 'unviewed'

    // ── DOM Elements ────────────────────────────────────────────────────────
    const articlesContainer = document.getElementById('articlesContainer');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const noResultsMessage = document.getElementById('noResultsMessage');
    const endOfFeedMessage = document.getElementById('endOfFeedMessage');
    const scrollSentinel = document.getElementById('scrollSentinel');
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const categoryPills = document.querySelectorAll('.category-pill');
    const viewedFilter = document.getElementById('viewedFilter');
    const sortSelect = document.getElementById('sortSelect');
    const resultsCountText = document.getElementById('resultsCountText');
    const resetFiltersBtn = document.getElementById('resetFiltersBtn');
    const clearAllBtn = document.getElementById('clearAllBtn');
    const weatherContent = document.getElementById('weatherContent');

    // ── LocalStorage: Viewed Articles Tracking ──────────────────────────────
    const STORAGE_VIEWED_KEY = 'dailyweb_viewed_articles';

    function getViewedArticles() {
        try {
            const stored = localStorage.getItem(STORAGE_VIEWED_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            return [];
        }
    }

    function markArticleAsViewed(articleId) {
        if (!articleId) return;
        const viewed = getViewedArticles();
        if (!viewed.includes(articleId)) {
            viewed.push(articleId);
            try {
                localStorage.setItem(STORAGE_VIEWED_KEY, JSON.stringify(viewed));
            } catch (e) {
                console.warn('Could not save viewed article to localStorage', e);
            }
        }
    }

    // ── Formatting Helpers ──────────────────────────────────────────────────
    // Every text value from the server is escaped before it goes into innerHTML,
    // so a title like "<img src=x onerror=...>" is shown as text instead of running.
    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }

    function getCategoryFallbackImage(category) {
        // Placeholder image by category, for articles without an image
        const cat = (category || '').toLowerCase();
        if (cat.includes('tech')) return 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80';
        if (cat.includes('sport')) return 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=600&auto=format&fit=crop&q=80';
        if (cat.includes('entertain') || cat.includes('music')) return 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80';
        if (cat.includes('environ') || cat.includes('nature')) return 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=600&auto=format&fit=crop&q=80';
        if (cat.includes('econ') || cat.includes('money')) return 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&auto=format&fit=crop&q=80';
        return 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=600&auto=format&fit=crop&q=80';
    }

    // ── Render Single Article Card ──────────────────────────────────────────
    function renderArticleCard(article) {
        const viewedList = getViewedArticles();
        const isViewed = viewedList.includes(article._id);
        const imageUrl = escapeHtml(article.imageUrl || getCategoryFallbackImage(article.category));
        const id = escapeHtml(article._id);
        const title = escapeHtml(article.title);

        const card = document.createElement('article');
        card.className = `article-card ${isViewed ? 'is-read' : 'is-unread'}`;
        card.dataset.id = article._id;

        // The summary is not escaped again: the server strips every tag from it (stripHtml),
        // and it keeps the article's HTML entities (e.g. &#39;) so they display correctly.
        card.innerHTML = `
            <a href="/article/${id}" class="card-image-link" tabindex="-1" aria-hidden="true">
                <img src="${imageUrl}" alt="${title}" class="card-image" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=600&auto=format&fit=crop&q=80'">
                <span class="card-category-badge">${escapeHtml(article.category)}</span>
                ${isViewed ? '<span class="card-read-badge">✓ Read</span>' : ''}
            </a>
            <div class="card-body">
                <div class="card-meta-top">
                    <span class="card-author">By <strong>${escapeHtml(article.author)}</strong></span>
                    <time class="card-date" datetime="${escapeHtml(article.createdAt)}">${formatDate(article.createdAt)}</time>
                </div>
                <h3 class="card-title">
                    <a href="/article/${id}" class="card-title-link">${title}</a>
                </h3>
                <p class="card-summary">${article.summary}</p>
                <div class="card-footer">
                    <span class="card-views" title="Total Views">👁️ ${escapeHtml(article.viewsCount)} views</span>
                    <a href="/article/${id}" class="card-read-more">Read full story &rarr;</a>
                </div>
            </div>
        `;

        // Mark as viewed in localStorage when clicked
        const links = card.querySelectorAll('a');
        links.forEach(link => {
            link.addEventListener('click', () => {
                markArticleAsViewed(article._id);
            });
        });

        return card;
    }

    // ── Fetch Articles via AJAX ─────────────────────────────────────────────
    async function fetchArticles(isReset = false) {
        if (isLoading) return;
        if (!isReset && !hasMore) return;

        isLoading = true;
        loadingIndicator.style.display = 'flex';
        endOfFeedMessage.style.display = 'none';
        noResultsMessage.style.display = 'none';

        if (isReset) {
            currentPage = 1;
            articlesContainer.innerHTML = '';
        }

        const viewedIds = getViewedArticles().join(',');

        const queryParams = new URLSearchParams({
            page: currentPage,
            limit: limit,
            category: currentCategory,
            search: currentSearch,
            sort: currentSort,
            viewed: currentViewed,
            viewedIds: viewedIds
        });

        try {
            const response = await fetch(`/api/articles?${queryParams.toString()}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                hasMore = data.hasMore;
                const articles = data.articles || [];

                if (articles.length === 0 && currentPage === 1) {
                    noResultsMessage.style.display = 'block';
                    resultsCountText.textContent = '0 articles found';
                } else {
                    const fragment = document.createDocumentFragment();
                    articles.forEach(article => {
                        fragment.appendChild(renderArticleCard(article));
                    });
                    articlesContainer.appendChild(fragment);

                    const currentLoadedCount = articlesContainer.children.length;
                    resultsCountText.textContent = `Showing ${currentLoadedCount} of ${data.total} published stories`;

                    if (!hasMore) {
                        endOfFeedMessage.style.display = 'block';
                    } else {
                        // The end of the feed may still be on screen (e.g. after a fast scroll) - check again
                        requestAnimationFrame(loadMoreIfNeeded);
                    }
                }
            } else {
                console.error('API Error:', data.message);
                resultsCountText.textContent = 'Failed to load articles.';
            }
        } catch (error) {
            console.error('Error fetching articles:', error);
            resultsCountText.textContent = 'Network error loading articles.';
        } finally {
            isLoading = false;
            loadingIndicator.style.display = 'none';
            updateActiveFilterUI();
            syncUrlParams();
        }
    }

    // ── Infinite Scroll ─────────────────────────────────────────────────────
    const PREFETCH_PX = 300; // start loading before the user reaches the very bottom

    // Load the next page when the end of the feed (the sentinel) is near the bottom of the
    // screen - or already above it. On phones the sidebar and footer sit below the feed, so a
    // fast scroll can pass the sentinel without it ever being on screen.
    function loadMoreIfNeeded() {
        if (isLoading || !hasMore || !scrollSentinel) return;
        if (scrollSentinel.getBoundingClientRect().top < window.innerHeight + PREFETCH_PX) {
            currentPage++;
            fetchArticles(false);
        }
    }

    function setupInfiniteScroll() {
        // The observer reacts when the sentinel comes into view...
        if ('IntersectionObserver' in window && scrollSentinel) {
            const observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) loadMoreIfNeeded();
            }, {
                root: null,
                rootMargin: `${PREFETCH_PX}px`,
                threshold: 0.1
            });
            observer.observe(scrollSentinel);
        }

        // ...and the scroll check also catches a sentinel that was scrolled past
        // (the observer only fires when it enters or leaves the screen). At most one check per frame.
        let scrollCheckPending = false;
        window.addEventListener('scroll', () => {
            if (scrollCheckPending) return;
            scrollCheckPending = true;
            requestAnimationFrame(() => {
                scrollCheckPending = false;
                loadMoreIfNeeded();
            });
        }, { passive: true });
    }

    // ── Search & Filter Handlers ────────────────────────────────────────────
    let searchDebounceTimeout = null;

    searchInput.addEventListener('input', (e) => {
        currentSearch = e.target.value.trim();
        clearSearchBtn.style.display = currentSearch ? 'block' : 'none';

        clearTimeout(searchDebounceTimeout);
        searchDebounceTimeout = setTimeout(() => {
            fetchArticles(true);
        }, 350);
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        currentSearch = '';
        clearSearchBtn.style.display = 'none';
        fetchArticles(true);
    });

    categoryPills.forEach(pill => {
        pill.addEventListener('click', () => {
            categoryPills.forEach(p => {
                p.classList.remove('active');
                p.setAttribute('aria-selected', 'false');
            });
            pill.classList.add('active');
            pill.setAttribute('aria-selected', 'true');

            currentCategory = pill.dataset.category || 'all';
            fetchArticles(true);
        });
    });

    viewedFilter.addEventListener('change', (e) => {
        currentViewed = e.target.value;
        fetchArticles(true);
    });

    sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        fetchArticles(true);
    });

    function resetFilters() {
        currentSearch = '';
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';

        currentCategory = 'all';
        categoryPills.forEach(p => {
            if (p.dataset.category === 'all') {
                p.classList.add('active');
                p.setAttribute('aria-selected', 'true');
            } else {
                p.classList.remove('active');
                p.setAttribute('aria-selected', 'false');
            }
        });

        currentViewed = 'all';
        viewedFilter.value = 'all';

        currentSort = 'date_desc';
        sortSelect.value = 'date_desc';

        fetchArticles(true);
    }

    resetFiltersBtn.addEventListener('click', resetFilters);
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', resetFilters);
    }

    function updateActiveFilterUI() {
        const isFilterActive = currentCategory !== 'all' || currentSearch !== '' || currentViewed !== 'all' || currentSort !== 'date_desc';
        resetFiltersBtn.style.display = isFilterActive ? 'inline-block' : 'none';
    }

    function syncUrlParams() {
        const params = new URLSearchParams();
        if (currentCategory !== 'all') params.set('category', currentCategory);
        if (currentSearch) params.set('search', currentSearch);
        if (currentViewed !== 'all') params.set('viewed', currentViewed);
        if (currentSort !== 'date_desc') params.set('sort', currentSort);

        const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
    }

    function initFromUrlParams() {
        const params = new URLSearchParams(window.location.search);
        if (params.has('category')) {
            currentCategory = params.get('category');
            categoryPills.forEach(p => {
                if (p.dataset.category === currentCategory) {
                    p.classList.add('active');
                    p.setAttribute('aria-selected', 'true');
                } else {
                    p.classList.remove('active');
                    p.setAttribute('aria-selected', 'false');
                }
            });
        }
        if (params.has('search')) {
            currentSearch = params.get('search');
            searchInput.value = currentSearch;
            clearSearchBtn.style.display = 'block';
        }
        if (params.has('viewed')) {
            currentViewed = params.get('viewed');
            viewedFilter.value = currentViewed;
        }
        if (params.has('sort')) {
            currentSort = params.get('sort');
            sortSelect.value = currentSort;
        }
    }

    // ── Weather Widget Integration (Sidebar) ────────────────────────────────
    async function loadWeatherWidget() {
        if (!weatherContent) return;

        try {
            const res = await fetch('/api/weather');
            const result = await res.json();

            if (res.ok && result.success && result.data) {
                const w = result.data;
                const cacheText = result.cached ? 'Updated recently' : 'Just updated';

                weatherContent.innerHTML = `
                    <div class="weather-main">
                        <span class="weather-icon">${escapeHtml(w.icon)}</span>
                        <div class="weather-temp-info">
                            <span class="weather-temp">${escapeHtml(w.temperature)}&deg;C</span>
                            <span class="weather-condition">${escapeHtml(w.condition)}</span>
                        </div>
                    </div>
                    <div class="weather-details">
                        <span>📍 ${escapeHtml(w.city)}</span>
                        <span>💨 Wind: ${escapeHtml(w.windSpeed)} km/h</span>
                    </div>
                    <div class="weather-status">
                        <small>${cacheText} (15m cache)</small>
                    </div>
                `;
            } else {
                // The weather service failed (e.g. missing / inactive API key) - show its message
                const msg = (result && result.message) ? result.message : 'OpenWeatherMap API connecting...';
                weatherContent.innerHTML = `
                    <div style="padding: 10px 0; font-size: 0.85rem; color: #666;">
                        <strong style="color: var(--primary-color);">OpenWeatherMap</strong>
                        <p style="margin-top: 5px;">${escapeHtml(msg)}</p>
                    </div>
                `;
            }
        } catch (err) {
            weatherContent.innerHTML = `
                <div style="padding: 10px 0; font-size: 0.85rem; color: #888;">
                    <span>OpenWeatherMap service offline</span>
                </div>
            `;
        }
    }

    // ── Initialization ──────────────────────────────────────────────────────
    initFromUrlParams();
    fetchArticles(true);
    setupInfiniteScroll();
    loadWeatherWidget();

});
