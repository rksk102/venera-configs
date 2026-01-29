class Picacg extends ComicSource {
    name = "Picacg"
    key = "picacg"
    version = "1.0.6"
    minAppVersion = "1.0.0"
    url = "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/picacg.js"
    static defaultApiUrl = "https://picaapi.picacomic.com"
    apiKey = "C69BAF41DA5ABD1FFEDC6D2FEA56B";

    getUuid() {
        let uuid = this.loadData('app_uuid');
        if (!uuid) {
            uuid = createUuid().replace(/-/g, '');
            this.saveData('app_uuid', uuid);
        }
        return uuid;
    }

    async ensureLoggedIn() {
        if (this.isLogged) return true;
        let account = this.loadData('account');
        if (Array.isArray(account) && account.length >= 2) {
            try {
                await this.account.login(account[0], account[1]);
                return true;
            } catch (e) { throw '自动重连失败，请手动登录账号'; }
        }
        throw '请先登录哔咔账号';
    }

    async _request(method, path, body = null) {
        const baseUrl = this.loadSetting('base_url') || Picacg.defaultApiUrl;
        const url = `${baseUrl}/${path}`;
        
        const execute = async () => {
            let headers = this.buildHeaders(method, path, this.loadData('token'));
            if (method === 'GET') {
                return await Network.get(url, headers);
            } else {
                let payload = typeof body === 'object' ? JSON.stringify(body) : body;
                return await Network.post(url, headers, payload);
            }
        };

        let res = await execute();
        if (res.status === 401) {
            await this.account.reLogin();
            res = await execute();
        }

        if (res.status !== 200) throw `网络异常 (${res.status})`;

        try {
            let json = JSON.parse(res.body);
            if (json.code === 200 && !json.data) throw "服务器繁忙，未返回有效数据";
            return json;
        } catch (e) {
            if (typeof e === 'string') throw e;
            throw "数据解析失败，请检查网络或分流";
        }
    }

    createSignature(path, nonce, time, method) {
        let data = path + time + nonce + method + this.apiKey;
        let key = '~d}$Q7$eIni=V)9\\RK/P.RM4;9[7|@/CA}b~OW!3?EV`:<>M7pddUBL5n|0/*Cn';
        return Convert.hmacString(Convert.encodeUtf8(key), Convert.encodeUtf8(data.toLowerCase()), 'sha256');
    }

    buildHeaders(method, path, token) {
        let time = (new Date().getTime() / 1000).toFixed(0);
        let nonce = createUuid().replace(/-/g, '');
        let signature = this.createSignature(path, nonce, time, method.toUpperCase());
        let baseUrl = this.loadSetting('base_url') || Picacg.defaultApiUrl;
        let host = baseUrl.replace(/https?:\/\//, "").split('/')[0];

        return {
            "api-key": this.apiKey,
            "accept": "application/vnd.picacomic.com.v1+json",
            "app-channel": this.loadSetting('appChannel') || "3",
            "authorization": token ?? "",
            "time": time,
            "nonce": nonce,
            "app-version": "2.2.1.3.3.4",
            "app-uuid": this.getUuid(),
            "image-quality": this.loadSetting('imageQuality') || "original",
            "app-platform": "android",
            "app-build-version": "45",
            "Content-Type": "application/json; charset=UTF-8",
            "user-agent": "okhttp/3.8.1",
            "version": "v1.4.1",
            "Host": host,
            "signature": signature,
        };
    }

    account = {
        login: async (account, pwd) => {
            const baseUrl = this.loadSetting('base_url') || Picacg.defaultApiUrl;
            let res = await Network.post(
                `${baseUrl}/auth/sign-in`,
                this.buildHeaders('POST', 'auth/sign-in'),
                JSON.stringify({ email: account, password: pwd })
            );
            if (res.status === 200) {
                let json = JSON.parse(res.body);
                this.saveData('token', json.data.token);
                this.saveData('account', [account, pwd]);
                return 'ok';
            }
            throw '登录失败，请核对账号密码';
        },
        reLogin: async () => {
            let account = this.loadData('account');
            if(!Array.isArray(account)) throw '未保存账号信息';
            return await this.account.login(account[0], account[1]);
        },
        logout: () => {
            this.deleteData('token');
            this.deleteData('account');
        },
        info: async () => {
            await this.ensureLoggedIn();
            let res = await this._request('GET', 'users/profile');
            let u = res.data.user;
            return {
                name: u.name,
                avatar: u.avatar ? (u.avatar.fileServer + '/static/' + u.avatar.path) : undefined,
                description: `Lv.${u.level} | ${u.title} | Exp: ${u.exp}`,
            };
        },
        registerWebsite: "https://manhuabika.com/pregister/?"
    }

    parseComic(comic) {
        if (!comic || !comic._id) return null;
        let tags = [];
        if (Array.isArray(comic.tags)) tags.push(...comic.tags);
        if (Array.isArray(comic.categories)) tags.push(...comic.categories);
        
        let coverUrl = "";
        if (comic.thumb) {
            let server = comic.thumb.fileServer || "https://storage-b.picacomic.com";
            if (!server.startsWith("http")) server = "https://" + server;
            coverUrl = server + '/static/' + comic.thumb.path;
        }

        return new Comic({
            id: comic._id,
            title: comic.title || "未知标题",
            subTitle: comic.author || "未知作者",
            cover: coverUrl,
            tags: tags,
            description: `${comic.totalLikes || comic.likesCount || 0} 喜欢`,
            maxPage: comic.pagesCount || 0,
        });
    }

    explore = [
        {
            title: "Picacg Random",
            type: "multiPageComicList",
            load: async () => {
                await this.ensureLoggedIn();
                let res = await this._request('GET', 'comics/random');
                return { comics: (res.data?.comics || []).map(c => this.parseComic(c)).filter(Boolean) };
            }
        },
        {
            title: "Picacg Latest",
            type: "multiPageComicList",
            load: async (page) => {
                await this.ensureLoggedIn();
                let res = await this._request('GET', `comics?page=${page}&s=dd`);
                let d = res.data?.comics;
                return { comics: (d?.docs || []).map(c => this.parseComic(c)).filter(Boolean), maxPage: d?.pages || 1 };
            }
        },
        {
            title: "Picacg H24",
            type: "multiPageComicList",
            load: async () => {
                await this.ensureLoggedIn();
                let res = await this._request('GET', 'comics/leaderboard?tt=H24&ct=VC');
                return { comics: (res.data?.comics || []).map(c => this.parseComic(c)).filter(Boolean) };
            }
        },
        {
            title: "Picacg D7",
            type: "multiPageComicList",
            load: async () => {
                await this.ensureLoggedIn();
                let res = await this._request('GET', 'comics/leaderboard?tt=D7&ct=VC');
                return { comics: (res.data?.comics || []).map(c => this.parseComic(c)).filter(Boolean) };
            }
        }
    ]

    category = {
        title: "Picacg",
        parts: [{
            name: "主题分类", type: "fixed",
            categories: ["大家都在看", "大濕推薦", "那年今天", "官方都在看", "嗶咔漢化", "全彩", "長篇", "同人", "短篇", "純愛", "百合花園", "耽美花園", "偽娘哲學", "後宮閃光", "扶他樂園", "单行本", "姐姐系", "妹妹系", "SM", "性轉換", "足の恋", "人妻", "NTR", "強暴", "非人類", "Cosplay", "重口地帶"],
            itemType: "category",
        }],
        enableRankingPage: true,
    }

    categoryComics = {
        load: async (category, param, options, page) => {
            await this.ensureLoggedIn();
            let type = param ?? 'c';
            let res = await this._request('GET', `comics?page=${page}&${type}=${encodeURIComponent(category)}&s=${options[0]}`);
            let d = res.data?.comics;
            return {
                comics: (d?.docs || []).map(c => this.parseComic(c)).filter(Boolean),
                maxPage: d?.pages || 1
            };
        },
        optionList: [{ options: ["dd-New to old", "da-Old to new", "ld-Most likes", "vd-Most nominated"] }],
        ranking: {
            options: ["H24-Day", "D7-Week", "D30-Month"],
            load: async (option) => {
                await this.ensureLoggedIn();
                let res = await this._request('GET', `comics/leaderboard?tt=${option}&ct=VC`);
                return { comics: (res.data?.comics || []).map(c => this.parseComic(c)).filter(Boolean), maxPage: 1 };
            }
        }
    }

    search = {
        load: async (keyword, options, page) => {
            await this.ensureLoggedIn();
            let path = `comics/advanced-search?page=${page}`;
            let res = await this._request('POST', path, { keyword: keyword, sort: options[0] });
            let d = res.data?.comics;
            return {
                comics: (d?.docs || []).map(c => this.parseComic(c)).filter(Boolean),
                maxPage: d?.pages || 1
            };
        },
        optionList: [{ options: ["dd-New to old", "da-Old to new", "ld-Most likes", "vd-Most nominated"], label: "Sort" }],
        // 新增：热门搜索词
        hotKeywords: async () => {
            try {
                let res = await this._request('GET', 'keywords');
                return res.data?.keywords || [];
            } catch (e) { return []; }
        }
    }

    favorites = {
        multiFolder: false,
        addOrDelFavorite: async (comicId) => {
            await this.ensureLoggedIn();
            await this._request('POST', `comics/${comicId}/favourite`, '{}');
            return 'ok';
        },
        loadComics: async (page) => {
            await this.ensureLoggedIn();
            let sort = this.loadSetting('favoriteSort') || 'dd';
            let res = await this._request('GET', `users/favourite?page=${page}&s=${sort}`);
            let d = res.data?.comics;
            return { comics: (d?.docs || []).map(c => this.parseComic(c)).filter(Boolean), maxPage: d?.pages || 1 };
        }
    }

    comic = {
        loadInfo: async (id) => {
            await this.ensureLoggedIn();
            let infoRes = await this._request('GET', `comics/${id}`);
            let info = infoRes.data?.comic;
            if (!info) throw "漫画详情不存在";

            let eps = new Map();
            let i = 1, allEps = [];
            while (i < 50) {
                let epRes = await this._request('GET', `comics/${id}/eps?page=${i}`);
                let docs = epRes.data?.eps?.docs || [];
                allEps.push(...docs);
                if (!epRes.data?.eps?.pages || epRes.data.eps.pages <= i) break;
                i++;
            }
            allEps.sort((a, b) => a.order - b.order).forEach((e, idx) => eps.set((idx + 1).toString(), e.title));

            let relatedRes = await this._request('GET', `comics/${id}/recommendation`);
            let related = (relatedRes.data?.comics || []).map(c => this.parseComic(c)).filter(Boolean);

            return new ComicDetails({
                title: info.title,
                cover: info.thumb ? (info.thumb.fileServer + '/static/' + info.thumb.path) : "",
                description: info.description,
                tags: { '作者': [info.author], '汉化组': [info.chineseTeam], '分类': info.categories, '标签': info.tags },
                chapters: eps,
                isFavorite: info.isFavourite ?? false,
                isLiked: info.isLiked ?? false,
                recommend: related,
                commentCount: info.commentsCount || 0,
                likesCount: info.likesCount || 0,
                uploader: info._creator?.name || "System",
                updateTime: info.updated_at ? info.updated_at.split('T')[0] : "",
                maxPage: info.pagesCount || 0,
            });
        },
        loadEp: async (comicId, epId) => {
            await this.ensureLoggedIn();
            let images = [], i = 1;
            while(i < 100) {
                let res = await this._request('GET', `comics/${comicId}/order/${epId}/pages?page=${i}`);
                if (!res.data?.pages) break;
                res.data.pages.docs.forEach(p => { if (p.media) images.push(p.media.fileServer + '/static/' + p.media.path); });
                if(!res.data.pages.pages || res.data.pages.pages <= i) break;
                i++;
            }
            return { images: images };
        },
        likeComic: async (id) => { await this._request('POST', `comics/${id}/like`, {}); return 'ok'; },
        loadComments: async (comicId, subId, page, replyTo) => {
            await this.ensureLoggedIn();
            let path = replyTo ? `comments/${replyTo}/childrens?page=${page}` : `comics/${comicId}/comments?page=${page}`;
            let res = await this._request('GET', path);
            let d = res.data?.comments;
            let comments = (d?.docs || []).map(c => new Comment({
                userName: c._user?.name || "Unknown",
                avatar: c._user?.avatar ? c._user.avatar.fileServer + '/static/' + c._user.avatar.path : undefined,
                id: c._id, content: c.content, isLiked: c.isLiked, score: c.likesCount ?? 0,
                replyCount: c.commentsCount, time: c.created_at,
            }));
            return { comments: comments, maxPage: d?.pages || 1 };
        },
        sendComment: async (comicId, subId, content, replyTo) => {
            let path = replyTo ? `comments/${replyTo}` : `comics/${comicId}/comments`;
            await this._request('POST', path, { content: content });
            return 'ok';
        },
        likeComment: async (comicId, subId, commentId) => {
            await this._request('POST', `comments/${commentId}/like`, '{}');
            return 'ok';
        },
        onClickTag: (namespace, tag) => {
            if(namespace === '作者') return { action: 'category', keyword: tag, param: 'a' };
            if(namespace === '分类') return { action: 'category', keyword: tag, param: 'c' };
            return { action: 'search', keyword: tag };
        }
    }

    settings = {
        base_url: { 
            title: "API地址", type: "input", default: Picacg.defaultApiUrl,
            validator: (v) => v.endsWith('/') ? v.substring(0, v.length - 1) : v
        },
        imageQuality: {
            type: 'select', title: '图片加载质量',
            options: [
                {value: 'original', text: '原图 (画质最高，加载慢)'}, 
                {value: 'medium', text: '中等 (推荐)'}, 
                {value: 'low', text: '低质量 (省流量)'}
            ],
            default: 'original',
        },
        appChannel: {
            type: 'select', title: '服务器分流 (若列表为空请切换)',
            options: [{value: '1', text: '分流 1'}, {value: '2', text: '分流 2'}, {value: '3', text: '分流 3 (主用)'}],
            default: '3',
        },
        favoriteSort: {
            type: 'select', title: '收藏夹漫画排序',
            options: [{value: 'dd', text: '最新收藏在前'}, {value: 'da', text: '最早收藏在前'}],
            default: 'dd',
        }
    }

    translation = {
        'zh_CN': {
            'Picacg Random': "哔咔随机", 'Picacg Latest': "哔咔最新", 'Picacg H24': "哔咔日榜",
            'Picacg D7': "哔咔周榜", 'Picacg D30': "哔咔月榜", 'New to old': "新到旧",
            'Old to new': "旧到新", 'Most likes': "最多喜欢", 'Most nominated': "最多指名",
            'Day': "日", 'Week': "周", 'Month': "月", 'Sort': "排序"
        },
        'zh_TW': {
            'Picacg Random': "嗶咔隨機", 'Picacg Latest': "嗶咔最新", 'Picacg H24': "嗶咔日榜",
            'Picacg D7': "嗶咔周榜", 'Picacg D30': "嗶咔月榜", 'New to old': "新到舊",
            'Old to new': "舊到新", 'Most likes': "最多喜歡", 'Most nominated': "最多指名",
            'Day': "日", 'Week': "周", 'Month': "月", 'Sort': "排序"
        }
    }
            }
