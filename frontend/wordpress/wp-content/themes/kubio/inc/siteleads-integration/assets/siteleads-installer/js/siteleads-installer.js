(function () {
  /**
   * Siteleads start
   */
  async function prepareSiteLeadsPlugin({
    setIsLoadingText = () => {},
    setErrorMessage = () => {},
    startSource
  } = {}) {
    let globalDataObject = window.kubiothemeSiteLeadsData;
    async function sleep(time) {
      return new Promise(resolve => setTimeout(resolve, time));
    }
    async function saveCustomizerSettings() {
      let promiseResolve;
      const promise = new Promise((resolve, reject) => {
        promiseResolve = resolve;
      });
      let doneCallback = () => {
        promiseResolve();
      };
      try {
        if (!_.isEmpty(wp.customize.dirtyValues())) {
          let executeCallback = true;
          wp.customize.bind('save', () => {
            if (executeCallback) {
              $(window).off('beforeunload');
              setTimeout(doneCallback, 2000);
              executeCallback = false;
            }
          });
          wp.customize.previewer.save();
        } else {
          $(window).off('beforeunload');
          setTimeout(doneCallback, 500);
        }
      } catch (e) {
        doneCallback();
        console.error(e);
      }
      await promise;
    }

    //same for the other file
    function getSiteLeadsBackendData(path, defaultValue) {
      return _.get(globalDataObject, path, defaultValue);
    }
    const siteLeadsIntegrationIsEnabled = getSiteLeadsBackendData('siteLeadsIntegrationIsEnabled');
    if (!siteLeadsIntegrationIsEnabled) {
      return;
    }
    function getTranslatedText(name) {
      return getSiteLeadsBackendData(['translations', name], name);
    }
    const PLUGIN_STATUSES = {
      NOT_INSTALLED: 'not-installed',
      INSTALLED: 'installed',
      ACTIVE: 'active'
    };
    let requestIsPending = false;
    let currentStatus = getSiteLeadsBackendData('pluginStatus');
    function setCurrentStatus(newValue) {
      currentStatus = newValue;
      globalDataObject.pluginStatus = newValue;
    }
    async function onHandleButtonClick() {
      if (currentStatus === PLUGIN_STATUSES.ACTIVE) {
        return;
      }
      if (requestIsPending) {
        return;
      }
      requestIsPending = true;
      switch (currentStatus) {
        case PLUGIN_STATUSES.NOT_INSTALLED:
          await installAndActivateSiteLeads();
          break;
        case PLUGIN_STATUSES.INSTALLED:
          await onActivateSiteLeads();
          break;
      }
      requestIsPending = false;
    }
    ;
    async function installAndActivateSiteLeads() {
      try {
        const installResponse = await onInstallSiteLeadsPlugin();
        if (!installResponse) {
          return false;
        }
        const activateResponse = await onActivateSiteLeads();
        if (!activateResponse) {
          return false;
        }
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    }
    ;
    async function onInstallSiteLeadsPlugin() {
      const slug = getSiteLeadsBackendData('pluginSlug');
      const promise = new Promise((resolve, reject) => {
        wp.updates.ajax("install-plugin", {
          slug: slug,
          success: () => {
            resolve();
          },
          error: e => {
            if ('folder_exists' === e.errorCode) {
              resolve();
            } else {
              reject();
            }
          }
        });
      });
      try {
        setIsLoadingText?.(getTranslatedText('info_notice_installing'));
        await promise;
        await sleep(100);
        setCurrentStatus(PLUGIN_STATUSES.INSTALLED);
        return true;
      } catch (e) {
        setErrorMessage?.(getTranslatedText('error_could_not_install_plugin'));
        console.error(e);
        return false;
      }
    }
    ;
    async function onActivateSiteLeads() {
      const activationUrl = getSiteLeadsBackendData('activationLink');
      let promise = new Promise(async (resolve, reject) => {
        try {
          let result = await fetch(activationUrl);
          if (!result?.ok) {
            reject(result?.statusText);
          }
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      try {
        setIsLoadingText?.(getTranslatedText('info_notice_activating'));
        await promise;
        setCurrentStatus(PLUGIN_STATUSES.ACTIVE);
        await sleep(100);
        await saveCustomizerSettings();
        await initSetupForSiteLeadsPlugin();
        await sleep(100);
        return true;
      } catch (e) {
        setErrorMessage?.(getTranslatedText('error_could_not_activate_plugin'));
        console.error(e);
        return false;
      }
    }
    ;
    async function initSetupForSiteLeadsPlugin() {
      const ajaxHandle = getSiteLeadsBackendData('siteLeadsInitWpAjaxHandle');
      const nonce = getSiteLeadsBackendData('siteLeadsNonce');
      const promise = new Promise((resolve, reject) => {
        wp.ajax.post(ajaxHandle, {
          _wpnonce: nonce,
          'start_source': startSource
        }).done(response => {
          resolve(response);
        }).fail(error => {
          reject(error);
        });
      });
      try {
        setIsLoadingText?.(getTranslatedText('info_notice_init'));
        await promise;
        await sleep(100);
        //  wp.customize.previewer.refresh();
      } catch (e) {
        setErrorMessage?.(getTranslatedText('error_could_not_init_plugin_data'));
        console.error(e);
        return false;
      }
    }
    ;
    await onHandleButtonClick();
  }
  top.prepareSiteLeadsPlugin = prepareSiteLeadsPlugin;
  /**
   * Siteleads end
   */
})();
