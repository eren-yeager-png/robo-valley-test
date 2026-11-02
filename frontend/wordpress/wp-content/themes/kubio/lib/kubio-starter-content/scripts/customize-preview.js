(function($) {
  let actionsOrder = ["install", "activate"];
  let isRunning = false;

  const parentWP = parent.wp;
  const KubioPluginManager = parent.KubioPluginManager;

  async function runActions(action, texts, payload) {
    parentWP.customize.previewer.save;
    isRunning = true;

    try {
      let extendPluginNotice = top.extendPluginNotice;
      if(!extendPluginNotice) {
        extendPluginNotice = function() {}
      }
    } catch(e) {
      console.error(e)
    }

    $(".kubio-starter-edit-overlay__loader").addClass("active");

    if (action === "install") {
      $(".kubio-starter-edit-overlay__loader__message").text(texts.install);
      KubioPluginManager.install({ source: "starter-content-overlay" }, () => {
        $(".kubio-starter-edit-overlay__loader__message").text(texts.install);
        KubioPluginManager.activate({
          source: "starter-content-overlay",
          payload,
        });
      });
    } else {
      $(".kubio-starter-edit-overlay__loader__message").text(texts.activate);
      KubioPluginManager.activate({
        source: "starter-content-overlay",
        payload,
      });
    }
  }

  function ucFirst(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  function handleCustomizerSectionsList(sectionClass, isFrontPage) {
    const panel = parentWP.customize.panel("front_content_panel");

    if (panel) {
      panel.onChangeActive(isFrontPage, {
        duration: 0,
        unchanged: false,
      });
      
      const sectionsIds = [...document.querySelectorAll(`.${sectionClass}`)]
        .map((i) => i.getAttribute("id"))
        .filter(Boolean);

      const sections = sectionsIds.map((id) => {
        const name = id.replace(/-/gim, " ").split(" ");
        return {
          id,
          label: name.map(ucFirst).join(" "),
        };
      });

      const sectionsContainer = panel.container.find(
        ".accordion-sub-container"
      );
      sectionsContainer.empty();

      sections.forEach((section) => {
        const item = $(`
        <li class="accordion-section control-section control-section-colibri_section" data-source="starter-content-sidebar">
          <h3 data-name="colibriwp_add_section" class="accordion-section-title starter-site-section-label" tabindex="0">
            ${section.label}
          </h3>
		    </li>
          `);

        item.attr(
          "payload",
          JSON.stringify({ section_id: section.id, section_action: "select" })
        );

        item.on("click", function(event) {
          event.preventDefault();
          event.stopPropagation();

          document.querySelector(`#${section.id}`)?.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "center",
          });

          setTimeout(() => {
            parentWP.customize.trigger(
              "colibri_panel_button_clicked",
              "colibriwp_add_section",
              event
            );
          }, 1000);
        });

        sectionsContainer.append(item);
      });
    }
  }

  window.kubioStarterContentPreview = function({
    sectionClass,
    texts,
    isFrontPage,
  }) {
    const { message, primaryButtonLabel, secondaryButtonLabel } = texts;
    const { status, activate_url, install_url } =
      parent.colibriwp_plugin_status || {};

    let buttonAction = status === "installed" ? "activate" : "install";

    const kubioStarterEditOverlay = `
        <div class="kubio-starter-edit-overlay">
          <div class="kubio-starter-edit-overlay__content">
            <div class="kubio-starter-edit-overlay__loader">
              <div class="kubio-starter-edit-overlay__spinner"></div>
              <div class="kubio-starter-edit-overlay__loader-message"></div>
            </div>
            <div class="kubio-starter-edit-overlay__messages">
              <div class="kubio-starter-edit-overlay__buttons">
                <button class="kubio-starter-edit-overlay__button button-1" data-name="edit">${primaryButtonLabel}</button>
                <button class="kubio-starter-edit-overlay__button button-2" data-name="replace">${secondaryButtonLabel}</button>
              </div>
              <div class="kubio-starter-edit-overlay__message">${message}</div>
            </div>
          </div>
        </div>
    `;

    function updateOverlayPosition($overlay) {
      $el = $overlay.data("el");
      $position = $el.offset();
      $overlay.css({
        top: $position.top,
        left: $position.left,
        height: $el.outerHeight(),
        width: $el.outerWidth(),
      });
    }

    function updateOverlaysPosition() {
       $(`.kubio-starter-edit-overlay`).each(function() {
         updateOverlayPosition($(this));
       });
    }

    function updateOverlays() {
      $(`.kubio-starter-edit-overlay`).remove();
      $(`.${sectionClass}`)
      .each(function() {
        const sectionId = $(this).attr("id");
        const $overlay = $(kubioStarterEditOverlay);
        $("body").append($overlay);
        $overlay.data("el", $(this));
        $overlay.find("button").attr("data-section", sectionId);
      });
      updateOverlaysPosition();
    }

    
    $(document).on("click", ".kubio-starter-edit-overlay__button", function() {
      nextActionIndex = actionsOrder.indexOf(buttonAction);
      runActions(buttonAction, texts, {
        section_action: $(this).data("name"),
        section_id: $(this).data("section"),
      });
    });

    const onUpdate = () => {
      if (_wpCustomizeSettings.theme.active) {
        handleCustomizerSectionsList(sectionClass, isFrontPage);
        updateOverlays();
      }
    };

    parentWP.customize.bind("pane-contents-reflowed", onUpdate);
    parentWP.customize.bind("save", onUpdate);

    
    $(window).on("resize.colibri-overlays", function() {
      updateOverlaysPosition();
    });

    parentWP.customize.bind("change", function (setting) {
      if (_wpCustomizeSettings.theme.active) {
        setTimeout(() => {
          updateOverlaysPosition();
        }, 500);
      }
    });

    onUpdate();
  };
})(jQuery);
