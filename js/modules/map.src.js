/**
 * @license Map plugin v0.1 for Highcharts
 *
 * (c) 2011 Torstein Hønsi
 *
 * License: www.highcharts.com/license
 */

/* 
 * See www.highcharts.com/studies/world-map.htm for use case.
 *
 * To do:
 * - Implement legend with specified value ranges
 * - Optimize long variable names and alias adapter methods and Highcharts namespace variables
 * 
 */
 (function(Highcharts) {
	var UNDEFINED,
		each = Highcharts.each,
		numberFormat = Highcharts.numberFormat,
		plotOptions = Highcharts.getOptions().plotOptions;
	
	/**
	 * Utility for reading SVG paths directly.
	 * 
	 * @todo Automatically detect strings in SVGElement.attr and use this. Split it into
	 * array only on demand, a) when transforming VML and b) before animation
	 */
	Highcharts.pathToArray = function (path) {
		// Move letters apart
		path = path.replace(/([A-Za-z])/g, ' $1 ');
		// Trim
		path = path.replace(/^\s*/, "").replace(/\s*$/, "");
		
		// Split on spaces and commas
		path = path.split(/[ ,]+/);
		
		for (var i = 0; i < path.length; i++) {
			if (!/[a-zA-Z]/.test(path[i])) {
				path[i] = parseFloat(path[i]);
			}
		}
		return path;
	};
				
	/**
	 * Extend the default options with map options
	 */
	plotOptions.map = Highcharts.merge(
		plotOptions.pie, {
			animation: false, // makes the complex shapes slow
			colorByPoint: false,
			dataLabels: {
				enabled: false
			},
			weightedOpacity: true,
			minOpacity: 0.2,
			nullColor: '#F8F8F8',
			shadow: false,
			showInLegend: true,
			borderColor: 'silver'
		}
	);
	
	/**
	 * Extend the point object (or area in the choropleth map) to pick the 
	 * color from value ranges
	 */
	var MapPoint = Highcharts.extendClass(Highcharts.Point, {
		/**
		 * Override the init method
		 */
		init: function () {

			var point = Highcharts.Point.prototype.init.apply(this, arguments),
				valueRanges = point.series.options.valueRanges,
				range,
				from,
				to,
				i;
			
			if (valueRanges) {
				i = valueRanges.length;
				while(i--) {
					range = valueRanges[i];
					from = range.from;
					to = range.to;
					if ((from === UNDEFINED || point.y >= from) && (to === UNDEFINED || point.y <= to)) {
						point.color = point.options.color = range.color;
						break;
					}
						
				}
			}
			return point;
		}
	});
	
	/**
	 * Add the series type
	 */
	Highcharts.seriesTypes.map = Highcharts.extendClass(Highcharts.seriesTypes.pie, {
		type: 'map',
		pointClass: MapPoint,
		
		init: function(chart) {
			var series = this,
				valueDecimals = chart.options.legend.valueDecimals,
				legendItems = [],
				name,
				from,
				to;
				
			Highcharts.Series.prototype.init.apply(this, arguments);
			
			if (series.options.valueRanges) {
				each(series.options.valueRanges, function(range) {
					from = range.from;
					to = range.to;
					
					// Assemble the default name. This can be overridden by legend.options.labelFormatter
					name = '';
					if (from === UNDEFINED) {
						name = '< '
					} else if (to === UNDEFINED) {
						name = '> ';
					}
					if (from !== UNDEFINED) {
						name += numberFormat(from, valueDecimals);
					}
					if (from !== UNDEFINED && to !== UNDEFINED) {
						name += ' - ';
					}
					if (to !== UNDEFINED) {
						name += numberFormat(to, valueDecimals);
					}
					
					// Add a mock object to the legend items
					legendItems.push(Highcharts.extend({
						name: name,
						options: {},
						type: 'pie', // force simpleSymbol (yes, it's bad design)
						visible: true,
						setState: function() {},
						setVisible: function() {}
					}, range));
				});
				series.legendItems = legendItems;
			}
		},
		
		getBox: function() {
			var series = this,
				chart = series.chart,
				factor,
				maxX = -Math.pow(2, 31), 
				minX =  Math.pow(2, 31) - 1, 
				maxY = -Math.pow(2, 31), 
				minY =  Math.pow(2, 31) - 1
			
			
			// Find the bounding box
			$.each(series.data, function(index, point) {
				var path = point.path,
					i = path.length,
					even = false; // while loop reads from the end
					
				while(i--) {
					if (typeof path[i] === 'number') {
						if (even) { // even = x
							maxX = Math.max(maxX, path[i]);
							minX = Math.min(minX, path[i]);
						} else { // odd = Y
							maxY = Math.max(maxY, path[i]);
							minY = Math.min(minY, path[i]);
						}
						even = !even;
					}
				}
			});
			
			// fit into the least of plot width or plot height
			factor = Math.min(
				chart.plotWidth / (maxX - minX),
				chart.plotHeight / (maxY - minY)
			);
			
			series.mapTranslation = {
				minX: minX,
				minY: minY,
				factor: factor 
			}
		},
		
		/**
		 * Translate the path so that it automatically fits into the plot area box
		 * @param {Object} path
		 */
		translatePath: function(path) {
			
			var series = this,
				chart = series.chart,
				even = false, // while loop reads from the end
				mapTranslation = series.mapTranslation,
				minX = mapTranslation.minX,
				minY = mapTranslation.minY,
				factor = mapTranslation.factor;
			
			// Do the translation
			i = path.length;
			while(i--) {
				if (typeof path[i] === 'number') {
					if (even) { // even = x
						path[i] = Math.round(chart.plotLeft + ((path[i] - minX) * factor));
					} else { // odd = Y
						path[i] = Math.round(chart.plotTop + ((path[i] - minY) * factor));
					}
					even = !even;
				}
			}
			return path;
		},
		
		/**
		 * Add the path option for data points. Find the max value for color calculation.
		 */
		translate: function () {
			var series = this,
				options = series.options,
				maxValue = 0,
				opacity,
				minOpacity = options.minOpacity,
				path,
				color;
	
			// Find the bounding box of the total map
			series.getBox();
	
			$.each(series.data, function (i, point) {
				
				point.shapeType = 'path';
				point.shapeArgs = series.translatePath(point.path);
				
				if (point.y > maxValue) {
					maxValue = point.y;
				}
				
			});
			
		},
		
		/**
		 * Disable data labels. To enable them, try using the column prototype and extend it
		 * with a label position similar to the tooltipPos in this plugin.
		 */
		drawDataLabels: function() {
			var series = this;
			
			Highcharts.seriesTypes.line.prototype.drawDataLabels.apply(series);
		}, 
		
		/** 
		 * Use the drawPoints method of column, that is able to handle simple shapeArgs.
		 * Extend it by assigning the tooltip position.
		 */
		drawPoints: function() {
			var series = this,
				chart = series.chart,
				saturation,
				bBox;
			
			// Make points pass test in drawing
			$.each(series.data, function (i, point) {
				point.plotY = 1; // pass null test in column.drawPoints
				if (point.y === null) {
					point.y = 0;
					point.isNull = true;
				}
			});
			
			// Draw them
			Highcharts.seriesTypes.column.prototype.drawPoints.apply(series);
			
			$.each(series.data, function (i, point) {
				bBox = point.graphic.getBBox();
				// for tooltip
				point.tooltipPos = [
					bBox.x + bBox.width / 2,
					bBox.y + bBox.height / 2
				];
				// for data labels
				point.plotX = point.tooltipPos[0] - chart.plotLeft;
				point.plotY = point.tooltipPos[1] - chart.plotTop; 
				
				// Reset escapted null points
				if (point.isNull) {
					point.y = null;
				}
			});
		},
		
		/**
		 * Inherit the trackers from scatter, which apply the tracking
		 * events to the point shapes directly
		 */
		drawTracker: Highcharts.seriesTypes.scatter.prototype.drawTracker
	});
})(Highcharts);