(function() {
    // http://paulirish.com/2011/requestanimationframe-for-smart-animating/
    // http://my.opera.com/emoller/blog/2011/12/20/requestanimationframe-for-smart-er-animating
    // requestAnimationFrame polyfill by Erik Möller. fixes from Paul Irish and Tino Zijdel
    // MIT license

    var lastTime = 0;
    var vendors = ['ms', 'moz', 'webkit', 'o'];
    for(var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
        window.requestAnimationFrame = window[vendors[x]+'RequestAnimationFrame'];
        window.cancelAnimationFrame = window[vendors[x]+'CancelAnimationFrame'] 
                                   || window[vendors[x]+'CancelRequestAnimationFrame'];
    }
 
    if (!window.requestAnimationFrame)
        window.requestAnimationFrame = function(callback, element) {
            var currTime = new Date().getTime();
            var timeToCall = Math.max(0, 16 - (currTime - lastTime));
            var id = window.setTimeout(function() { callback(currTime + timeToCall); }, 
              timeToCall);
            lastTime = currTime + timeToCall;
            return id;
        };
 
    if (!window.cancelAnimationFrame)
        window.cancelAnimationFrame = function(id) {
            clearTimeout(id);
        };
}());

(function() {

    // Global variables
    var ulla,                           // Ulla sprite
        item_pool = [],                 // Array of callbacks generating items
        active_items = {},              // Active item sprites. keys: IDs, values: sprite Objects.
        score_tooltips = [],            // Score tooltips
        health = [],                    // Health sprites
        level = 0,                      // Current level of the game. Higher level means faster enemies and more frequent spawns.
        nextID = 0,                     // ID of the next spawned object
        lastItemSpawn = 0,              // Last time in ms in which an item was spawned
        nextItemSpawn = 0,              // Time in ms before the next item spawn. Random between 500 and 3000.
        lastNyanSpawn = 0,              // Last time in ms in which a Nyan cat was spawned
        nextNyanSpawn =                 // Time in ms before the next Nyan cat spawn. Random between 10000 and 20000.
            randomIntFromInterval(10000, 20000),
        lastClownSpawn = 0,             // Last time in ms in which a clown was spawned
        nextClownSpawn =                // Time in ms before the next clown spawn. Random between 10000 and 20000.
            randomIntFromInterval(10000, 20000),
        framesUntilGC = 60,             // Number of frames between every garbage collect operation
        score = 0,                      // Game score
        scoreText,                      // Score text element
        keys = [],                      // Pressed keys on keyboard
        canvas,                         // Main canvas element
        animation,                      // requestAnimationFrame return
        paused = false;                 // pause bool
        debug = false;                  // debug mode shows hitboxes

    /*
     *
     *    MAIN GAME LOOP
     *
     */
    function gameLoop(now) {
        // If the game is paused, return
        if (paused) return;

        animation = window.requestAnimationFrame(gameLoop);

        // Clear the canvas
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);

        // Draw background
        background = new Image();
        background.src = "img/background.png";
        canvas.getContext("2d").drawImage(background, 0, 0);

        // Update and render active items
        for (var key in active_items) {
            if (active_items.hasOwnProperty(key)) {
                active_items[key].update();
                active_items[key].render();
            }
        }

        // Update score tooltips
        for (i = 0; i < score_tooltips.length; i += 1) {
            if (score_tooltips[i].ticksLeft > 0) {
                score_tooltips[i].render();
                score_tooltips[i].ticksLeft -= 1;
            } else {
                score_tooltips.splice(i, 1);
            }
        }

        // Update score
        scoreText.text = "SCORE: " + score.toString();
        scoreText.render();

        // Check if ulla is dead
        if (ulla.dead) {
            ulla.update();
            ulla.render();
            stop();
            return;
        }

        // See if any directional keys are pressed
        ulla.clearmove();
        if (keys && keys[37]) {ulla.moveleft();}    // Left arrow
        if (keys && keys[38]) {ulla.jump();}        // Up arrow
        if (keys && keys[39]) {ulla.moveright();}   // Right arrow

        // Update and render main character
        ulla.update();
        ulla.render();

        // Check if a new item needs to be spawned
        if(!lastItemSpawn || now - lastItemSpawn >= nextItemSpawn) {
            lastItemSpawn = now;
            spawnItem();
            nextItemSpawn = randomIntFromInterval(Math.max(0, 500 - (50*level)), 3000 - (100*level));
        }

        // Check if a new nyan needs to be spawned
        if(now - lastNyanSpawn >= nextNyanSpawn) {
            lastNyanSpawn = now;
            spawnNyan();
            nextNyanSpawn = randomIntFromInterval(10000 - (1000*level), 20000 - (1000*level));
        }

        // Check if a new clown needs to be spawned
        if(now - lastClownSpawn >= nextClownSpawn) {
            lastClownSpawn = now;
            spawnClown();
            nextClownSpawn = randomIntFromInterval(10000 - (1000*level), 20000 - (1000*level));
        }

        // Check if ulla is crashing with some active item
        for (var key in active_items) {
            if (active_items.hasOwnProperty(key) && ulla.crashWith(active_items[key])) {
                active_items[key].callback();
            }
        }

        // Decrease remaining frames in which ulla is happy or hurt
        if (ulla.isHappy) {
            ulla.isHappy -= 1;
        }

        if (ulla.isHurt) {
            ulla.isHurt -= 1;
        } else {
            ulla.stopBlinking();
        }

        // Update health
        for (i = 0; i < health.length; i++) {
            health[i].update();
            health[i].render();
        }

        // Garbage collection of off-screen sprites
        framesUntilGC -= 1;

        if (!framesUntilGC) {
            garbageCollect();
            framesUntilGC = 600;
        }

        level = Math.floor(score / 5000);

    }
    
    /*
     *
     *    GENERIC ANIMATED SPRITE
     *    
     *        Includes API for:
     *            - updating position
     *            - rendering
     *            - knowing if it's in the air or on the ground
     *            - knowing if it's colliding with another sprite
     *
     */
    function sprite(options) {
        this.frameIndex = 0;
        this.tickCount = 0;
        this.numberOfFrames = options.numberOfFrames || 1;
        this.ticksPerFrame = options.ticksPerFrame || 0;
        this.hitboxMargin = options.hitboxMargin || 0;
        this.bounded = options.bounded || 0;
        this.gravity = options.gravity || 0;
        this.context = options.context;
        this.image = options.image;
        this.width = options.width;
        this.height = options.height;
        this.x = options.x;
        this.y = options.y;

        this.blinking = false;
        this.blinkTicks = 0;
        this.blinkTickCount = 0;
        this.enableRender = true;
        
        this.speedX = 0;
        this.speedY = 0;
        this.scaleRatio = 1;
        
        this.update = function () {

            this.tickCount += 1;

            if (this.tickCount > this.ticksPerFrame) {

                this.tickCount = 0;
                
                // If the current frame index is in range
                if (this.frameIndex < this.numberOfFrames - 1) {  
                    // Go to the next frame
                    this.frameIndex += 1;
                } else {
                    this.frameIndex = 0;
                }
            }

            if (this.blinking) {
                this.blinkTickCount += 1;

                if (this.blinkTickCount > this.blinkTicks) {
                    this.blinkTickCount = 0;
                    this.enableRender = !this.enableRender;
                }
            }

            // Calculate new X position based on current speed
            new_x = this.x += this.speedX;
            
            // Prevent going past the right edge
            if (this.bounded && new_x < 0) {
                this.x = 0;
            }
            // Prevent going past the left edge
            else if (this.bounded && new_x + this.getFrameWidth() > canvas.width) {
                this.x = canvas.width - this.getFrameWidth();
            }
            else {
                this.x = new_x;
            }

            // Gravity only acts on sprites which are in the air
            if (this.inTheAir()) {
                this.speedY += this.gravity;
            }

            // Calculate new Y position based on current speed
            new_y = this.y += this.speedY;
            
            // Prevent going past the bottom edge
            if (this.bounded && new_y + this.height > canvas.height) {
                this.y = canvas.height - this.height;
            }
            else {
                this.y = new_y;
            }

        };
        
        this.render = function () {
            if (this.enableRender) {
                // Draw the frame
                this.context.drawImage(
                    this.image,
                    this.frameIndex * this.width / this.numberOfFrames,
                    0,
                    this.width / this.numberOfFrames,
                    this.height,
                    this.x,
                    this.y,
                    this.width / this.numberOfFrames * this.scaleRatio,
                    this.height * this.scaleRatio);

                if (debug) {
                    this.context.beginPath();
                    this.context.moveTo(this.x + this.hitboxMargin, this.y + this.hitboxMargin);
                    this.context.lineTo(this.x + this.getFrameWidth() - this.hitboxMargin, this.y + this.hitboxMargin);
                    this.context.lineTo(this.x + this.getFrameWidth() - this.hitboxMargin, this.y + this.height - this.hitboxMargin);
                    this.context.lineTo(this.x + this.hitboxMargin, this.y + this.height - this.hitboxMargin);
                    this.context.lineTo(this.x + this.hitboxMargin, this.y + this.hitboxMargin);
                    this.context.stroke();
                }
            }
        };
        
        this.getFrameWidth = function () {
            return this.width / this.numberOfFrames;
        };

        this.inTheAir = function() {
            return this.y < canvas.height - this.height;
        };

        this.onTheGround = function() {
            return !this.inTheAir();
        };

        this.isOffScreen = function() {
            return (this.x + this.getFrameWidth() < 0) || (this.y + this.height < 0) || (this.x > canvas.width) || (this.y > canvas.height);
        };

        this.blinkEvery = function(blinkTicks) {
            this.blinkTicks = blinkTicks;
            this.blinking = true;
        };

        this.stopBlinking = function() {
            this.blinking = false;
            this.blinkTicks = 0;
            this.blinkTickCount = 0;
            this.enableRender = true;
        };

        this.crashWith = function(other) {
            var myleft = this.x + this.hitboxMargin;
            var myright = this.x + this.getFrameWidth() - this.hitboxMargin;
            var mytop = this.y + this.hitboxMargin;
            var mybottom = this.y + this.height - this.hitboxMargin;
            var otherleft = other.x + other.hitboxMargin;
            var otherright = other.x + other.getFrameWidth() - other.hitboxMargin;
            var othertop = other.y + other.hitboxMargin;
            var otherbottom = other.y + other.height - other.hitboxMargin;
            var crash = true;
            if ((mybottom < othertop) || (mytop > otherbottom) || (myright < otherleft) || (myleft > otherright)) {
                crash = false;
            }
            return crash;
        };
    }

    function text(options) {
        this.context = options.context;
        this.font = options.font;
        this.color = options.color;
        this.stroke = options.stroke || 0;
        this.x = options.x;
        this.y = options.y;
        this.text = options.text;

        this.render = function() {
            this.context.font = this.font;
            this.context.fillStyle = this.color;
            if (this.stroke) {
                this.context.strokeStyle = this.stroke;
                this.context.lineWidth = 5;
                this.context.strokeText(this.text, this.x, this.y);
                this.context.strokeStyle = "black";
                this.context.lineWidth = 1;
            }
            this.context.fillText(this.text, this.x, this.y);
        }
    }
    

    /*
     *
     *    Creates the main character sprite and extends it with additional
     *    properties, which are functions used e.g. to move it left, move
     *    it right, jump, make happy, or die.
     *
     */
    function createUlla(options) {
        // Create main characters and extend it with
        // additional properties (methods).
        ulla = new sprite(options);

        ulla.dead = false;
        ulla.health = 6;

        ulla.clearmove = function() {
            if (keys && keys[40]) {
                if (ulla.isHurt) {
                    ulla.image.src = "img/ulla/ulla_duck_static_hurt.gif"
                    ulla.height = 162;
                }
                else if (ulla.isHappy) {
                    ulla.image.src = "img/ulla/ulla_duck_static_happy.gif"
                    ulla.height = 162;
                } else {
                    ulla.image.src = "img/ulla/ulla_duck_static.gif"
                    ulla.height = 162;
                }
            } else {
                if (ulla.isHurt) {
                    ulla.image.src = "img/ulla/ulla_static_hurt.gif"
                    ulla.height = 192;
                }
                else if (ulla.isHappy) {
                    ulla.image.src = "img/ulla/ulla_static_happy.gif"
                    ulla.height = 192;
                } else {
                    ulla.image.src = "img/ulla/ulla_static.gif"
                    ulla.height = 192;
                }
            }
            ulla.width = 113;
            ulla.numberOfFrames = 1;
            ulla.ticksPerFrame = 0;
            ulla.speedX = 0;
        }

        ulla.moveleft = function() {
            if (keys && keys[40]) {
                if (ulla.isHurt) {
                    ulla.image.src = "img/ulla/ulla_duck_left_hurt.gif"
                    ulla.height = 162;
                }
                else if (ulla.isHappy) {
                    ulla.image.src = "img/ulla/ulla_duck_left_happy.gif"
                    ulla.height = 162;
                } else {
                    ulla.image.src = "img/ulla/ulla_duck_left.gif"
                    ulla.height = 162;
                }
            } else {
                if (ulla.isHurt) {
                    ulla.image.src = "img/ulla/ulla_left_hurt.gif"
                    ulla.height = 192;
                }
                else if (ulla.isHappy) {
                    ulla.image.src = "img/ulla/ulla_left_happy.gif"
                    ulla.height = 192;
                } else {
                    ulla.image.src = "img/ulla/ulla_left.gif"
                    ulla.height = 192;
                }
            }
            ulla.width = 904;
            ulla.numberOfFrames = 8;
            ulla.ticksPerFrame = 4;
            ulla.speedX = -8 - Math.floor(level/2);
        }

        ulla.moveright = function() {
            if (keys && keys[40]) {
                if (ulla.isHurt) {
                    ulla.image.src = "img/ulla/ulla_duck_right_hurt.gif"
                    ulla.height = 162;
                }
                else if (ulla.isHappy) {
                    ulla.image.src = "img/ulla/ulla_duck_right_happy.gif"
                    ulla.height = 162;
                } else {
                    ulla.image.src = "img/ulla/ulla_duck_right.gif"
                    ulla.height = 162;
                }
            } else {
                if (ulla.isHurt) {
                    ulla.image.src = "img/ulla/ulla_right_hurt.gif"
                    ulla.height = 192;
                }
                else if (ulla.isHappy) {
                    ulla.image.src = "img/ulla/ulla_right_happy.gif"
                    ulla.height = 192;
                } else {
                    ulla.image.src = "img/ulla/ulla_right.gif"
                    ulla.height = 192;
                }
            }
            ulla.width = 904;
            ulla.numberOfFrames = 8;
            ulla.ticksPerFrame = 4;
            ulla.speedX = 8 + Math.floor(level/2);
        }

        ulla.jump = function() {
            if (ulla.onTheGround()) {
                ulla.speedY = -22;
            }
        }

        ulla.makeHappy = function() {
            // Number of frames to be happy
            ulla.isHappy = 60;
        }

        ulla.hurt = function() {
            ulla.health -= 1;

            updateHealth();

            if (!ulla.health) {
                ulla.die();
            }

            // Number of frames to be hurt
            ulla.isHurt = 180;

            ulla.blinkEvery(12);
        }

        ulla.die = function() {
            ulla.image.src = "img/ulla/ulla_dead.gif"
            ulla.width = 190;
            ulla.height = 85;
            ulla.y = canvas.height - ulla.height;
            ulla.numberOfFrames = 1;
            ulla.ticksPerFrame = 0;
            ulla.speedX = 0;
            ulla.speedY = 0;
            ulla.dead = true;
        }

        return ulla;
    }

    /*
     *
     *    Creates an array of callbacks used to generate new items.
     *    Each item is basically a sprite object which is extended with
     *    another callback, that is called whenever ulla crashes with
     *    the item in game.
     *
     */
    function createItemPool() {
        item_pool.push(function() {
                sunflower = new sprite({
                    context: canvas.getContext("2d"),
                    width: 80,
                    height: 67,
                    x: 0,
                    y: -100,
                    image: new Image(),
                    hitboxMargin: 5,
                    gravity: 0.01 + (0.01 * level)
                });

                sunflower.callback = function() {
                    score += 100;
                    showScoreTooltip(100, this.x, this.y, this.width, this.height);
                    ulla.makeHappy();
                    delete active_items[this.ID];
                };

                sunflower.image.src = "img/items/sunflower.gif";

                return sunflower;
        });

        item_pool.push(function() {
                tulip = new sprite({
                    context: canvas.getContext("2d"),
                    width: 80,
                    height: 87,
                    x: 0,
                    y: -109,
                    image: new Image(),
                    hitboxMargin: 5,
                    gravity: 0.01 + (0.01 * level)
                });

                tulip.callback = function() {
                    score += 150;
                    showScoreTooltip(150, this.x, this.y, this.width, this.height);
                    ulla.makeHappy();
                    delete active_items[this.ID];
                };

                tulip.image.src = "img/items/tulip.gif";

                return tulip;
        });

        item_pool.push(function() {
                lemon = new sprite({
                    context: canvas.getContext("2d"),
                    width: 90,
                    height: 87,
                    x: 0,
                    y: -100,
                    image: new Image(),
                    hitboxMargin: 5,
                    gravity: 0.05 + (0.01 * level)
                });

                lemon.callback = function() {
                    score += 200;
                    showScoreTooltip(200, this.x, this.y, this.width, this.height);
                    ulla.makeHappy();
                    delete active_items[this.ID];
                };

                lemon.image.src = "img/items/lemon.gif";

                return lemon;
        });

        item_pool.push(function() {
                bean = new sprite({
                    context: canvas.getContext("2d"),
                    width: 70,
                    height: 62,
                    x: 0,
                    y: -100,
                    image: new Image(),
                    hitboxMargin: 5,
                    gravity: 0.04 + (0.01 * level)
                });

                bean.callback = function() {
                    if (!ulla.isHurt) {
                        ulla.hurt();
                    }
                    delete active_items[this.ID];
                };

                bean.image.src = "img/items/bean.gif";

                return bean;
        });

        item_pool.push(function() {
                honey = new sprite({
                    context: canvas.getContext("2d"),
                    width: 65,
                    height: 90,
                    x: 0,
                    y: -100,
                    image: new Image(),
                    hitboxMargin: 5,
                    gravity: 0.08 + (0.01 * level)
                });

                honey.callback = function() {
                    score += 300;
                    showScoreTooltip(300, this.x, this.y, this.width, this.height);
                    ulla.makeHappy();
                    delete active_items[this.ID];
                };

                honey.image.src = "img/items/honey.gif";

                return honey;
        });

        item_pool.push(function() {
                beer = new sprite({
                    context: canvas.getContext("2d"),
                    width: 80,
                    height: 84,
                    x: 0,
                    y: -100,
                    image: new Image(),
                    hitboxMargin: 5,
                    gravity: 0.12 + (0.01 * level)
                });

                beer.callback = function() {
                    score += 350;
                    showScoreTooltip(350, this.x, this.y, this.width, this.height);
                    ulla.makeHappy();
                    delete active_items[this.ID];
                };

                beer.image.src = "img/items/beer.gif";

                return beer;
        });

        item_pool.push(function() {
                wine = new sprite({
                    context: canvas.getContext("2d"),
                    width: 60,
                    height: 92,
                    x: 0,
                    y: -100,
                    image: new Image(),
                    hitboxMargin: 5,
                    gravity: 0.08 + (0.01 * level)
                });

                wine.callback = function() {
                    score += 400;
                    showScoreTooltip(400, this.x, this.y, this.width, this.height);
                    ulla.makeHappy();
                    delete active_items[this.ID];
                };

                wine.image.src = "img/items/wine.gif";

                return wine;
        });
    }

    function spawnItem() {
        // Choose a random item from the item pool
        var item = item_pool[randomIntFromInterval(0, item_pool.length - 1)]();

        // Randomize its x starting position
        item.x = randomIntFromInterval(0, canvas.width - item.getFrameWidth());

        // Make it fall down towards the ground at random speed
        item.speedY = randomIntFromInterval(1, 3);
        
        // Push it into the active items
        item.ID = nextID;
        active_items[nextID] = item;

        nextID++;
    }

    function showScoreTooltip(score, x, y, w, h) {
        tooltip = new text({
            context: canvas.getContext("2d"),
            font: "40px Consolas",
            color: "white",
            stroke: "black",
            x: Math.floor(x + (w/2)),
            y: Math.floor(y + (h/2)),
            text: score.toString()
        });

        tooltip.ticksLeft = 60;

        score_tooltips.push(tooltip);
    }

    function spawnNyan() {
        nyan = new sprite({
            numberOfFrames: 12,
            ticksPerFrame: 4,
            hitboxMargin: 0,
            bounded: false,
            gravity: 0,
            context: canvas.getContext("2d"),
            image: new Image(),
            width: 2772,
            height: 161,
            x: -231,
            y: canvas.height - 162 - 161
        });

        nyan.speedX = randomIntFromInterval(3 + level, 7 + level);

        var right_direction = randomIntFromInterval(0, 1);

        if (right_direction) {
            nyan.x = -231;
            nyan.image.src = "img/nyan_right.gif";
        } else {
            nyan.x = canvas.width;
            nyan.speedX = -nyan.speedX;
            nyan.image.src = "img/nyan_left.gif";
        }

        nyan.callback = function() {
            if (!ulla.isHurt) {
                ulla.hurt();
            }
        };

        nyan.ID = nextID;

        active_items[nextID] = nyan;
        nextID++;
    }

    function spawnClown() {
        clown = new sprite({
            numberOfFrames: 15,
            ticksPerFrame: 4,
            hitboxMargin: 100,
            bounded: false,
            gravity: 0,
            context: canvas.getContext("2d"),
            image: new Image(),
            width: 4350,
            height: 290,
            x: -181,
            y: canvas.height - 210
        });

        clown.speedX = randomIntFromInterval(3 + level, 9 + level);

        var right_direction = randomIntFromInterval(0, 1);

        if (right_direction) {
            clown.x = -231;
            clown.image.src = "img/clown_right.gif";
        } else {
            clown.x = canvas.width;
            clown.speedX = -clown.speedX;
            clown.image.src = "img/clown_left.gif";
        }

        clown.callback = function() {
            if (!ulla.isHurt) {
                ulla.hurt();
            }
        };

        clown.ID = nextID;

        active_items[nextID] = clown;
        nextID++;
    }

    function garbageCollect() {
        // Remove items which have gone off screen
        for (var key in active_items) {
            if (active_items.hasOwnProperty(key) && active_items[key].isOffScreen()) {
                delete active_items[key];                    
            }
        }
    }

    function updateHealth() {
        switch(ulla.health) {
            case 6:
                break;
            case 5:
                health[2].image.src = "img/heart_half.gif";
                break;
            case 4:
                health[2].enableRender = false;
                break;
            case 3:
                health[1].image.src = "img/heart_half.gif";
                break;
            case 2:
                health[1].enableRender = false;
                break;
            case 1:
                health[0].image.src = "img/heart_half.gif";
                break;
            case 0:
                health[0].enableRender = false;
                break;
            default:
                break;
        }
    }

    function pause() {
        paused = !paused;
        if (!paused) gameLoop();
    }

    function stop() {
        // Stops the game.
        window.cancelAnimationFrame(animation);
    }

    function preloadAssets() {
        assets = ["img/background.png",
                  "img/clown_left.gif",
                  "img/clown_right.gif",
                  "img/nyan_left.gif",
                  "img/nyan_right.gif",
                  "img/heart_half.gif",
                  "img/heart_full.gif",
                  "img/items/bean.gif",
                  "img/items/beer.gif",
                  "img/items/honey.gif",
                  "img/items/lemon.gif",
                  "img/items/sunflower.gif",
                  "img/items/tulip.gif",
                  "img/items/wine.gif",
                  "img/ulla/ulla_dead.gif",
                  "img/ulla/ulla_duck_left.gif",
                  "img/ulla/ulla_duck_left_happy.gif",
                  "img/ulla/ulla_duck_left_hurt.gif",
                  "img/ulla/ulla_duck_right.gif",
                  "img/ulla/ulla_duck_right_happy.gif",
                  "img/ulla/ulla_duck_right_hurt.gif",
                  "img/ulla/ulla_duck_static.gif",
                  "img/ulla/ulla_duck_static_happy.gif",
                  "img/ulla/ulla_duck_static_hurt.gif",
                  "img/ulla/ulla_left.gif",
                  "img/ulla/ulla_left_happy.gif",
                  "img/ulla/ulla_left_hurt.gif",
                  "img/ulla/ulla_left_hurt.gif",
                  "img/ulla/ulla_right.gif",
                  "img/ulla/ulla_right_happy.gif",
                  "img/ulla/ulla_right_hurt.gif",
                  "img/ulla/ulla_static.gif",
                  "img/ulla/ulla_static_happy.gif",
                  "img/ulla/ulla_static_hurt.gif"];

        for (var i = 0; i < assets.length; i++) {
            im = new Image();
            im.src = assets[i];
        }
    }

    function randomIntFromInterval(min, max) // min and max included
    {
        return Math.floor(Math.random()*(max-min+1)+min);
    }

    // Get canvas
    canvas = document.getElementById("ulla");
    canvas.width = 1152;
    canvas.height = 648;

    // Create main character
    ulla = createUlla({
        context: canvas.getContext("2d"),
        width: 111,
        height: 192,
        x: 348,
        y: 423,
        image: new Image(),
        hitboxMargin: 10,
        bounded: true,
        gravity: 1
    });

    // Create score
    scoreText = new text({
        context: canvas.getContext("2d"),
        font: "30px Consolas",
        color: "black",
        stroke: "red",
        x: 910,
        y: 70,
        text: ""
    });

    // Create health
    for (i = 0; i < 3; i++) {
        h = new sprite({context: canvas.getContext("2d"),
                        width: 50,
                        height: 47,
                        x: 40+60*i,
                        y: 40,
                        image: new Image()});

        h.image.src = "img/heart_full.gif"
        health.push(h);
    }

    // Create item pool
    createItemPool();

    // Preload assets
    preloadAssets();

    // Start game loop
    gameLoop();

    // Add key event listeners
    window.addEventListener('keydown', function (e) {
        keys = (keys || []);
        keys[e.keyCode] = true;

        if (e.keyCode == 32) {
            pause();
        }
    });
    window.addEventListener('keyup', function (e) {
        keys[e.keyCode] = false;
    });

}());