/**
 * Leaflet.SmoothWheelZoom
 *
 * @author Yuki Utsumi (https://github.com/mutsuyuki)
 * @license MIT
 *
 * Smooth wheel zoom handler for Leaflet maps.
 * Compatible with Leaflet 1.x and 2.x.
 *
 * Usage:
 *   var map = L.map('map', {
 *       smoothWheelZoom: true,   // enable smooth zoom (default: true)
 *       smoothSensitivity: 1,    // zoom speed multiplier (default: 1)
 *       zoomSnap: 0              // recommended for smoothest experience
 *   });
 *
 * Options:
 *   - smoothWheelZoom: true | false | 'center'
 *       true: zoom toward mouse cursor (default)
 *       'center': always zoom toward map center
 *       false: disable smooth wheel zoom
 *   - smoothSensitivity: number (default: 1)
 *       Multiplier for zoom speed. Higher = faster zoom.
 */

(function (factory) {
    var SmoothWheelZoomClass = null;

    function init() {
        var L = typeof window !== 'undefined' ? window.L : null;
        if (typeof define === 'function' && define.amd) {
            define(['leaflet'], factory);
        } else if (typeof module !== 'undefined' && module.exports) {
            module.exports = factory(require('leaflet'));
        } else if (L && L.Handler) {
            SmoothWheelZoomClass = factory(L);
        } else if (typeof window !== 'undefined') {
            setTimeout(init, 10);
        }
    }

    // Expose global API for ESM environments where L is loaded separately
    if (typeof window !== 'undefined') {
        window.SmoothWheelZoom = {
            addTo: function (map, options) {
                if (!SmoothWheelZoomClass) {
                    var attempts = 0;
                    var tryAdd = function() {
                        if (SmoothWheelZoomClass) {
                            window.SmoothWheelZoom._doAddTo(map, options);
                        } else if (attempts++ < 100) {
                            setTimeout(tryAdd, 10);
                        }
                    };
                    tryAdd();
                    return null;
                }
                return window.SmoothWheelZoom._doAddTo(map, options);
            },
            _doAddTo: function(map, options) {
                var handler = new SmoothWheelZoomClass(map);
                map.smoothWheelZoom = handler;
                handler._map = map;
                if (!options || options.smoothWheelZoom !== false) {
                    handler.enable();
                }
                return handler;
            }
        };
    }

    init();
}(function (L) {
    'use strict';

    L.Map.mergeOptions({
        smoothWheelZoom: true,
        smoothSensitivity: 1
    });

    L.Map.SmoothWheelZoom = L.Handler.extend({

        addHooks: function () {
            this._onWheelScroll = this._onWheelScroll.bind(this);
            L.DomEvent.on(this._map._container, 'wheel', this._onWheelScroll, this);
        },

        removeHooks: function () {
            L.DomEvent.off(this._map._container, 'wheel', this._onWheelScroll, this);
        },

        // Leaflet 2.x compatibility: get wheel delta
        _getWheelDelta: function (e) {
            if (L.DomEvent.getWheelDelta) {
                return L.DomEvent.getWheelDelta(e);
            }
            // Leaflet 2.x implementation
            var factor = (navigator.platform.indexOf('Mac') === 0) ? 3 : 1;
            if (e.deltaMode === 0) {
                return -e.deltaY / (40 * factor);
            } else if (e.deltaMode === 1) {
                return -e.deltaY * (4 / factor);
            }
            return -e.deltaY;
        },

        // Leaflet 2.x compatibility: convert mouse event to container point
        _mouseEventToContainerPoint: function (e) {
            if (this._map.mouseEventToContainerPoint) {
                return this._map.mouseEventToContainerPoint(e);
            }
            // Leaflet 2.x implementation
            var container = this._map._container;
            var rect = container.getBoundingClientRect();
            return new L.Point(
                e.clientX - rect.left - container.clientLeft,
                e.clientY - rect.top - container.clientTop
            );
        },

        _onWheelScroll: function (e) {
            if (!this._isWheeling) {
                this._onWheelStart(e);
            }
            this._onWheeling(e);
        },

        _onWheelStart: function (e) {
            var map = this._map;
            this._isWheeling = true;
            this._wheelMousePosition = this._mouseEventToContainerPoint(e);
            this._centerPoint = map.getSize().divideBy(2);
            this._startLatLng = map.containerPointToLatLng(this._centerPoint);
            this._wheelStartLatLng = map.containerPointToLatLng(this._wheelMousePosition);
            this._startZoom = map.getZoom();
            this._moved = false;
            this._zooming = true;

            map.stop();
            if (map._panAnim) map._panAnim.stop();

            this._goalZoom = map.getZoom();
            this._prevCenter = map.getCenter();
            this._prevZoom = map.getZoom();

            this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
        },

        _onWheeling: function (e) {
            var map = this._map;

            this._goalZoom = this._goalZoom + this._getWheelDelta(e) * 0.003 * map.options.smoothSensitivity;
            if (this._goalZoom < map.getMinZoom() || this._goalZoom > map.getMaxZoom()) {
                this._goalZoom = map._limitZoom(this._goalZoom);
            }
            this._wheelMousePosition = this._mouseEventToContainerPoint(e);

            clearTimeout(this._timeoutId);
            this._timeoutId = setTimeout(this._onWheelEnd.bind(this), 200);

            L.DomEvent.preventDefault(e);
            L.DomEvent.stopPropagation(e);
        },

        _onWheelEnd: function () {
            this._isWheeling = false;
        },

        _updateWheelZoom: function () {
            var map = this._map;

            if (!map.getCenter().equals(this._prevCenter) || map.getZoom() !== this._prevZoom) {
                cancelAnimationFrame(this._zoomAnimationId);
                return;
            }

            var zoomDiff = this._goalZoom - map.getZoom();
            if (Math.abs(zoomDiff) < 0.005 && !this._isWheeling) {
                cancelAnimationFrame(this._zoomAnimationId);
                if (this._moved) {
                    map._moveEnd(true);
                    this._moved = false;
                }
                return;
            }

            this._zoom = map.getZoom() + zoomDiff * 0.3;
            this._zoom = Math.floor(this._zoom * 100) / 100;

            var delta = this._wheelMousePosition.subtract(this._centerPoint);
            if (delta.x === 0 && delta.y === 0) {
                this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
                return;
            }

            if (map.options.smoothWheelZoom === 'center') {
                this._center = this._startLatLng;
            } else {
                this._center = map.unproject(map.project(this._wheelStartLatLng, this._zoom).subtract(delta), this._zoom);
            }

            if (!this._moved) {
                map._moveStart(true, false);
                this._moved = true;
            }

            map._move(this._center, this._zoom);
            this._prevCenter = map.getCenter();
            this._prevZoom = map.getZoom();

            this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
        }
    });

    L.Map.addInitHook('addHandler', 'smoothWheelZoom', L.Map.SmoothWheelZoom);

    return L.Map.SmoothWheelZoom;
}));
