// ==UserScript==
// @name         Canada ePost Mail Downloader
// @namespace    https://secnem.com
// @version      1.0
// @description  Loops over all your mail items and attempts to download them to your computer for storage
// @author       You
// @match        https://www.canadapost-postescanada.ca/inbox/*
// @icon         https://www.canadapost-postescanada.ca/web/assets/img/icons/cpo.ico
// @grant        GM.xmlHttpRequest
// @run-at       document-end
// @downloadUrl  https://raw.githubusercontent.com/novamxd/epostdownloader/main/index.js
// @updateUrl    https://raw.githubusercontent.com/novamxd/epostdownloader/main/index.js
// ==/UserScript==
(async function() {
    'use strict';

    const NUMBER_OF_RETRIES = 3;

    async function simpleGet(path) {
        return new Promise(function(resolve, reject) {
            GM.xmlHttpRequest({
                method: "GET",
                url: path,
                responseType: "arraybuffer",
                headers: {
                    csrf: jQuery("meta[name='sso-token']").attr("content")
                },
                onload: function(response) {
                    const headers = response
                        .responseHeaders
                        .split(/\r\n/)
                        .map(h => h.split(/\s*:\s*/))
                        .reduce((m, kvp) => {
                            m[kvp[0].toLowerCase()] = kvp[1];
                            return m;
                        }, {});

                    console.info("Got headers for", path, headers);

                    const contentType = headers["content-type"];

                    if (contentType.indexOf("text/html") >= 0) {
                        console.info("Got text response for", path);
                        resolve({
                            content: response.responseText,
                            contentType: contentType
                        });
                    } else if (contentType.indexOf("application/vnd.cpc.inbox-v1+json") >= 0) {
                        console.info("Got JSON response for", path);
                        resolve({
                            content: JSON.parse(response.responseText),
                            contentType: contentType
                        });
                    } else if (response.response) {
                        console.info("Got binary response for", path);
                        resolve({
                            content: response.response,
                            contentType: contentType
                        });
                    }
                },
                onerror: function(response) {
                    console.info("Got error for", path, response);
                    reject(response);
                }
            });
        });
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    var saveByteArray = (function() {
        var a = document.createElement("a");
        document.body.appendChild(a);
        a.style = "display: none";
        return function(data, name) {
            const blob = new Blob(data, {
                    type: "octet/stream"
                }),
                url = window.URL.createObjectURL(blob);
            a.href = url;
            a.download = name;
            a.click();
            window.URL.revokeObjectURL(url);
        };
    }());

    async function getDocumentIframe(mailItem) {

        let targetUri = `https://www.epost.ca/service/displayEpostInboxMail.a?documentId=${mailItem.mailItemID}&language=en&source=myinbox`;
        let attempts = 0;

        while (true) {

            if (attempts == NUMBER_OF_RETRIES) {
                throw new Error(`Unable to follow SSO redirect after ${NUMBER_OF_RETRIES} attempts.`);
            }

            const iframe = await simpleGet(targetUri);
            console.info("Got iframe for", mailItem, targetUri);

            if (iframe.content.indexOf("SSO Redirection") == -1) {
                return iframe.content;
            }

            const ssoRedirect = [...iframe.content.matchAll(/url=(https:\/\/.*?\/service\/displayEpostInboxMail.a.*?)"/gm)];
            console.info("Got SSO redirect path for", mailItem, ssoRedirect);

            targetUri = ssoRedirect[0][1];

            attempts++;
        }
    }

    async function downloadMailItem(mailItem) {

        const iframe = await getDocumentIframe(mailItem);
        console.info("Got iframe for", mailItem);

        const documentPath = [...iframe.matchAll(/src="(\/service\/displayMailStream.a.*?)"/gm)];
        console.info("Got document path for", mailItem, documentPath);

        const mailDocument = await simpleGet(`https://www.epost.ca${documentPath[0][1]}`, "arraybuffer");
        console.info(`Got document of ${mailDocument.content.length} bytes for`, mailItem);

        const mailFileName = `${mailItem.billerDisplayName}-${mailItem.billDate}-${mailItem.shortDescription}-${mailItem.mailItemID}`;

        if (mailDocument.contentType.indexOf("text/html") >= 0) {
            saveByteArray([mailDocument.content, {
                type: 'text/html'
            }], `${mailFileName}.html`);
        } else if (mailDocument.contentType.indexOf("application/pdf") >= 0) {
            saveByteArray([mailDocument.content, {
                type: 'application/pdf'
            }], `${mailFileName}.pdf`);
        }

        await sleep(500);
    }

    async function downloadAllMail() {
        let offset = 0;
        let limit = 15;

        while (true) {

            const mailItems = await simpleGet(`https://www.canadapost-postescanada.ca/inbox/rs/mailitem?folderId=0&sortField=1&order=D&offset=${offset}&limit=${limit}`);

            if (mailItems.content.mailitemInfos.length == 0) {
                break;
            }

            for (const mailItem of mailItems.content.mailitemInfos) {
                for (let t = 0; t < NUMBER_OF_RETRIES; t++) {
                    try {
                        await downloadMailItem(mailItem);
                        break;
                    } catch (e) {
                        if (t == NUMBER_OF_RETRIES - 1) {
                            console.error("Failed to download mail item. Exhausted retries.", mailItem, e);
                        } else {
                            console.error("Failed to download mail item. Trying again.", mailItem, e);
                        }
                    }
                }
            }
            offset += limit;
        }
    }

    const mainThread = setInterval(function() {
        const mailActionsBar = jQuery("#mail-action-bar");

        if (mailActionsBar.length == 0) {
            return;
        }

        clearInterval(mainThread);

        const downloadBar = jQuery(document.createElement("div"));
        downloadBar.addClass("large-12 medium-12 small-12 columns");
        mailActionsBar.after(downloadBar);

        const downloadAllButton = jQuery(document.createElement("a"));
        downloadAllButton
            .attr("role", "button")
            .addClass("button radius large-4 medium-4 small-4")
            .text("Download All Mail")
            .on("click", async function() {
                downloadAllButton.attr("disabled", "disabled");
                downloadAllButton.text("Downloading...");
                await downloadAllMail();
                downloadAllButton.text("Done! Check your downloads.");
                await sleep(15000);
                downloadAllButton
                    .removeAttr("disabled")
                    .text("Download All Mail");
            });
        downloadBar.append(downloadAllButton);
    }, 50);
})();